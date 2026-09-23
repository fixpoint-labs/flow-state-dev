/**
 * Goal check — a runtime hire made by an app with no authentication does not
 * take the rest of the roster down at the next boot.
 *
 * See goal.md for the contract and the source-revert control.
 *
 * Run: pnpm tsx goals/hire-plane/reload-survives-an-unaddressable-row/run.mts
 */
import { defineFlow, handler, type FlowInstance } from "@flow-state-dev/core";
import {
  DEFAULT_ORG_ID,
  type JsonObject,
  type ResourceCollectionRef,
} from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import {
  defineHiredRosterCollection,
  reloadHiredSeats,
  toHiredSeatRow,
  workerConfigSchema,
} from "@flow-state-dev/workforce";
import { z } from "zod";
import { loadFixture, runGoal } from "../../lib/index.mts";

type Fixture = {
  namedOrg: string;
  namedUser: string;
  devUser: string;
  devSeatId: string;
  namedSeatId: string;
  strayOrg: string;
  straySeatId: string;
  marker: string;
};

type Router = {
  GET: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
  POST: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
};

const fixture = loadFixture<Fixture>(import.meta.url);

/** A roster row as the store's JSON shape — the same cast the seat-hire writer makes. */
function asStored(row: ReturnType<typeof toHiredSeatRow>): JsonObject {
  return row as unknown as JsonObject;
}

const resources = { roster: defineHiredRosterCollection() };
const hireInput = z.object({ seatId: z.string() });
const tagInput = z.object({ tag: z.string() });

/**
 * The runtime-hire write an app makes: the org is the session's, and the row
 * goes in with `create()`. Nothing here chooses the org — an app with no
 * resolver gets DEFAULT_ORG_ID from the framework, which is the whole case.
 */
const hire = handler({
  name: "hire",
  inputSchema: hireInput,
  outputSchema: z.object({ orgId: z.string() }),
  resources,
  execute: async (input, ctx) => {
    const orgId = ctx.session.identity.orgId ?? "";
    const roster = ctx.resources.roster as unknown as ResourceCollectionRef;
    await roster.create(
      input.seatId,
      asStored(toHiredSeatRow({ seatId: input.seatId, flow: "clerk", owningOrgId: orgId })),
    );
    return { orgId };
  },
});

/** What a reloaded seat does when asked: record who answered, and as whom. */
const answer = handler({
  name: "answer",
  inputSchema: tagInput,
  outputSchema: z.object({ answeredAs: z.string() }),
  execute: (_input, ctx) => ({ answeredAs: (ctx.flow as unknown as { id: string }).id }),
});

const clerk = defineFlow({
  kind: "clerk",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: { answer: { inputSchema: tagInput, block: answer } },
});
const kinds = { clerk };

const hiring = defineFlow({
  kind: "hiring",
  resources,
  actions: { hire: { inputSchema: hireInput, block: hire } },
});

const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  },
};

async function call(
  router: Router,
  method: "GET" | "POST",
  path: string[],
  body?: unknown,
  who?: { user: string; org: string },
) {
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
}

/** Open a session on `flowId`, run one action, and wait for it to settle. */
async function runAction(
  router: Router,
  flowId: string,
  userId: string,
  action: string,
  input: unknown,
  who?: { user: string; org: string },
): Promise<{ http: number; outcome?: string; detail?: unknown }> {
  const session = await call(router, "POST", [flowId, "sessions"], { userId }, who);
  if (session.status !== 201) return { http: session.status, detail: session.json };
  const sessionId = session.json.session.id as string;
  const posted = await call(router, "POST", [flowId, sessionId, "actions", action], { userId, input }, who);
  if (posted.status >= 400) return { http: posted.status, detail: posted.json };
  const requestId = posted.json.request?.id as string;
  for (let i = 0; i < 200; i++) {
    const status = (await call(router, "GET", [flowId, "requests", requestId, "status"], undefined, who))
      .json?.status as string | undefined;
    if (status && !["pending", "in_progress", "running", "queued"].includes(status)) {
      return { http: posted.status, outcome: status };
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  return { http: posted.status, outcome: "timed-out" };
}

await runGoal(async () => {
  const failures: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);
  const stores = inMemoryStores();
  const namedAddress = `${fixture.namedOrg}.${fixture.namedSeatId}`;

  // (a) An app with no resolver hires at runtime. One store is shared by both
  //     apps below because it is ONE deployment's database seen twice.
  const devApp = createFlowState({
    flows: { hiring: hiring() },
    stores: { default: { primary: stores } },
  });
  const devRouter = (await devApp.getRouter()) as Router;
  const devHire = await runAction(devRouter, "hiring", fixture.devUser, "hire", {
    seatId: fixture.devSeatId,
  });
  if (devHire.outcome !== "completed") fail("a", `dev hire did not complete: ${JSON.stringify(devHire)}`);
  const devRuntime = await devApp.getRuntime();
  const devRow = await devRuntime.stores.resourceState.get(
    "org",
    DEFAULT_ORG_ID,
    `workforce/roster/${fixture.devSeatId}`,
  );
  if (devRow === undefined) fail("a", `no roster row landed under ${DEFAULT_ORG_ID}`);

  // (b) A signed-in organization hires through the same action.
  const authedApp = createFlowState({
    flows: { hiring: hiring() },
    resolvePrincipal: verified.resolvePrincipal,
    stores: { default: { primary: stores } },
  });
  const authedRouter = (await authedApp.getRouter()) as Router;
  const who = { user: fixture.namedUser, org: fixture.namedOrg };
  const namedHire = await runAction(
    authedRouter,
    "hiring",
    fixture.namedUser,
    "hire",
    { seatId: fixture.namedSeatId },
    who,
  );
  if (namedHire.outcome !== "completed") fail("b", `named hire did not complete: ${JSON.stringify(namedHire)}`);

  // (d) setup: a row in the named org's cell stamped for another org — the
  //     fence FIX-1529 added, which this fix must not loosen.
  const primary = await stores.resolve(["primary"]);
  await primary.resourceState!.set(
    "org",
    fixture.namedOrg,
    `workforce/roster/${fixture.straySeatId}`,
    asStored(toHiredSeatRow({ seatId: fixture.straySeatId, flow: "clerk", owningOrgId: fixture.strayOrg })),
    "any",
  );

  // (c) The restart: a fresh app over the same store reloads BOTH orgs, the
  //     default one first so it is the first row the reload meets.
  const restarted = createFlowState({
    flows: {},
    resolvePrincipal: verified.resolvePrincipal,
    stores: { default: { primary: stores } },
  });
  const restartedRuntime = await restarted.getRuntime();
  let reload: Awaited<ReturnType<typeof reloadHiredSeats>> | undefined;
  try {
    reload = await reloadHiredSeats({
      stores: restartedRuntime.stores,
      orgIds: [DEFAULT_ORG_ID, fixture.namedOrg],
      kinds,
    });
  } catch (error) {
    fail("c", `reload rejected, so no org's seats came back: ${(error as Error).message}`);
  }

  if (reload !== undefined) {
    const ids = reload.seats.map((seat) => seat.id);
    if (!ids.includes(namedAddress)) fail("c", `reload did not return ${namedAddress}; got ${JSON.stringify(ids)}`);
    const devProblem = reload.problems.find(
      (problem) => problem.includes(DEFAULT_ORG_ID) && problem.includes(fixture.devSeatId),
    );
    if (devProblem === undefined) {
      fail("c", `the default-org row was not named in problems: ${JSON.stringify(reload.problems)}`);
    }
    const strayProblem = reload.problems.find((problem) => problem.includes(fixture.strayOrg));
    if (strayProblem === undefined || !strayProblem.includes("cannot be registered under")) {
      fail("d", `the row stamped for ${fixture.strayOrg} was not refused: ${JSON.stringify(reload.problems)}`);
    }
    if (ids.some((id) => id.endsWith(`.${fixture.straySeatId}`))) {
      fail("d", `the row stamped for ${fixture.strayOrg} was minted: ${JSON.stringify(ids)}`);
    }

    // (c) The reloaded seat is not just returned; it registers and answers.
    for (const seat of reload.seats) {
      restarted.register(seat as FlowInstance, { pin: seat.ownerPin ?? { orgId: fixture.namedOrg } });
    }
    const restartedRouter = (await restarted.getRouter()) as Router;
    const answered = await runAction(
      restartedRouter,
      namedAddress,
      fixture.namedUser,
      "answer",
      { tag: fixture.marker },
      who,
    );
    if (answered.outcome !== "completed") {
      fail("c", `${namedAddress} did not answer after restart: ${JSON.stringify(answered)}`);
    }

    if (failures.length === 0) {
      return {
        failures,
        evidence:
          `dev hire stored under ${DEFAULT_ORG_ID}; reload over [${DEFAULT_ORG_ID}, ${fixture.namedOrg}] ` +
          `returned ${JSON.stringify(ids)} and ${reload.problems.length} problems; ` +
          `${namedAddress} answered after restart; default-org row named: ${devProblem}; ` +
          `stray row refused: ${strayProblem}`,
      };
    }
  }
  return { failures, evidence: "" };
});
