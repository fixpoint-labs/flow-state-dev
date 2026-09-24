/**
 * Goal check — one stored hire that can never be a seat does not blank an
 * organization's seat listing.
 *
 * See goal.md for the contract and the source-revert control.
 *
 * Run: pnpm tsx goals/hire-plane/discover-survives-an-unaddressable-row/run.mts
 */
import {
  createManifestRegistry,
  defineFlow,
  discoveryTools,
  handler,
  sequencer,
} from "@flow-state-dev/core";
import {
  DEFAULT_ORG_ID,
  type JsonObject,
  type ResourceCollectionRef,
} from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import {
  defineHiredRosterCollection,
  defineSeatInventoryCollection,
  toHiredSeatRow,
  workforceManifestSources,
} from "@flow-state-dev/workforce";
import { z } from "zod";
import { loadFixture, runGoal } from "../../lib/index.mts";

type Fixture = {
  devUser: string;
  devHireSeatId: string;
  fileSeatId: string;
  fileSeatPurpose: string;
  namedOrg: string;
  namedUser: string;
  namedSeatId: string;
  namedSeatInstructions: string;
  tildeSeatId: string;
  strayOrg: string;
  straySeatId: string;
};

type Router = {
  GET: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
  POST: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
};

type DomainResult = { domain: string; entries: { id: string; purpose: string }[]; problem?: string };

const fixture = loadFixture<Fixture>(import.meta.url);

const SEATS = "seatRows";
const ROSTER = "roster";
const resources = {
  [SEATS]: defineSeatInventoryCollection(),
  [ROSTER]: defineHiredRosterCollection(),
};

/**
 * The runtime-hire write an app makes: a roster row stamped with the
 * session's org, and — where the seat has an address — its inventory row.
 * Nothing here chooses the org. An app with no resolver gets DEFAULT_ORG_ID
 * from the framework, which is the whole case.
 */
const hireInput = z.object({
  seatId: z.string(),
  instructions: z.string().nullable().default(null),
  listedAs: z.string().nullable().default(null),
});
const hire = handler({
  name: "hire",
  inputSchema: hireInput,
  outputSchema: z.object({ orgId: z.string() }),
  resources,
  execute: async (input, ctx) => {
    const orgId = ctx.session.identity.orgId ?? "";
    const roster = ctx.resources[ROSTER] as unknown as ResourceCollectionRef;
    await roster.create(
      input.seatId,
      toHiredSeatRow({
        seatId: input.seatId,
        flow: "agent",
        instructions: input.instructions,
        owningOrgId: orgId,
      }) as unknown as JsonObject,
    );
    if (input.listedAs !== null) {
      const seats = ctx.resources[SEATS] as unknown as ResourceCollectionRef;
      await seats.create(input.listedAs, { id: input.listedAs, kind: "agent" });
    }
    return { orgId };
  },
});

/** A seat registered from the file tree: its inventory row, and nothing else. */
const listInput = z.object({ id: z.string() });
const list = handler({
  name: "list-seat",
  inputSchema: listInput,
  outputSchema: z.object({ id: z.string() }),
  resources,
  execute: async (input, ctx) => {
    const seats = ctx.resources[SEATS] as unknown as ResourceCollectionRef;
    await seats.create(input.id, { id: input.id, kind: "agent" });
    return { id: input.id };
  },
});

/**
 * The discovery door a seat's `discover` tool is, built the way
 * `createWorkforceCapability` builds it: the workforce's sources in one
 * registry, the door over it. Run as an action so no model sits between the
 * door and the check.
 */
const { discover } = discoveryTools(
  createManifestRegistry(
    workforceManifestSources({
      roster: {
        workers: [
          { id: fixture.fileSeatId, declared: { description: fixture.fileSeatPurpose }, body: "" },
        ],
        channels: [],
      },
      inventory: { seats: SEATS },
      hiredRoster: ROSTER,
    }),
  ),
);
const discoverInput = z.object({ domain: z.string().nullable().default("seats") });
const discoverSeats = sequencer({ name: "discover-seats", inputSchema: discoverInput }).step(discover);

const desk = defineFlow({
  kind: "desk",
  resources,
  actions: {
    hire: { inputSchema: hireInput, block: hire },
    list: { inputSchema: listInput, block: list },
    discover: { inputSchema: discoverInput, block: discoverSeats },
  },
});

const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  },
};

type Who = { user: string; org: string };

async function call(router: Router, method: "GET" | "POST", path: string[], body?: unknown, who?: Who) {
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

function unwrap(output: unknown): unknown {
  return typeof output === "object" && output !== null && (output as { kind?: unknown }).kind === "inline"
    ? (output as { value: unknown }).value
    : output;
}

/**
 * Open a session, run one action, wait for it to settle, and return the
 * outputs its blocks recorded. An action's return value rides its blocks'
 * trace rows; the request record has no `output` field of its own.
 */
async function runAction(
  app: ReturnType<typeof createFlowState>,
  userId: string,
  action: string,
  input: unknown,
  who?: Who,
): Promise<{ outcome: string; outputs: unknown[]; detail?: unknown }> {
  const router = (await app.getRouter()) as Router;
  const session = await call(router, "POST", ["desk", "sessions"], { userId }, who);
  if (session.status !== 201) return { outcome: `http-${session.status}`, outputs: [], detail: session.json };
  const sessionId = session.json.session.id as string;
  const posted = await call(router, "POST", ["desk", sessionId, "actions", action], { userId, input }, who);
  if (posted.status >= 400) return { outcome: `http-${posted.status}`, outputs: [], detail: posted.json };
  const requestId = posted.json.request?.id as string;
  const stores = (await app.getRuntime()).stores;
  for (let i = 0; i < 400; i++) {
    const record = (await stores.request.get(requestId)) as
      | { status?: string; error?: unknown; items?: Array<Record<string, unknown>> }
      | undefined;
    if (record?.status !== undefined && !["pending", "in_progress", "running", "queued"].includes(record.status)) {
      const outputs = (record.items ?? [])
        .filter((item) => item.type === "block_trace")
        .map((item) => unwrap(item.output));
      return { outcome: record.status, outputs, detail: record.error };
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  return { outcome: "timed-out", outputs: [] };
}

/** The seats domain out of a `discover` run, wherever in the trace it landed. */
function seatsDomain(outputs: unknown[]): DomainResult | undefined {
  for (const output of outputs) {
    const domains = (output as { domains?: DomainResult[] } | undefined)?.domains;
    const seats = domains?.find((domain) => domain.domain === "seats");
    if (seats !== undefined) return seats;
  }
  return undefined;
}

await runGoal(async () => {
  const failures: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);
  const stores = inMemoryStores();

  // (a) An app with no resolver: the file-declared seat is registered, and a
  //     runtime hire leaves a roster row under DEFAULT_ORG_ID.
  const devApp = createFlowState({ flows: { desk: desk() }, stores: { default: { primary: stores } } });
  const listed = await runAction(devApp, fixture.devUser, "list", { id: fixture.fileSeatId });
  if (listed.outcome !== "completed") fail("a", `registering the file seat did not complete: ${JSON.stringify(listed)}`);
  const devHire = await runAction(devApp, fixture.devUser, "hire", { seatId: fixture.devHireSeatId });
  if (devHire.outcome !== "completed") fail("a", `dev hire did not complete: ${JSON.stringify(devHire)}`);
  const devRow = await (await devApp.getRuntime()).stores.resourceState.get(
    "org",
    DEFAULT_ORG_ID,
    `workforce/roster/${fixture.devHireSeatId}`,
  );
  if (devRow === undefined) fail("a", `no roster row landed under ${DEFAULT_ORG_ID}`);

  // (b) The dev session asks who it can hand work to.
  const devDiscover = await runAction(devApp, fixture.devUser, "discover", { domain: "seats" });
  const devSeats = seatsDomain(devDiscover.outputs);
  if (devDiscover.outcome !== "completed" || devSeats === undefined) {
    fail("b", `dev discover returned no seats domain: ${JSON.stringify(devDiscover)}`);
  } else {
    if (devSeats.problem !== undefined) fail("b", `the dev org's seats domain degraded to a problem: ${devSeats.problem}`);
    const file = devSeats.entries.find((entry) => entry.id === fixture.fileSeatId);
    if (file === undefined || file.purpose !== fixture.fileSeatPurpose) {
      fail("b", `the file-declared seat was not listed with its purpose: ${JSON.stringify(devSeats.entries)}`);
    }
  }

  // (c) A signed-in org hires one good seat. Beside it in the same cell: a row
  //     whose seat id carries the user-owned `~` marker, and a row stamped for
  //     another org (FIX-1529's fence) whose inventory row also exists.
  const namedApp = createFlowState({
    flows: { desk: desk() },
    resolvePrincipal: verified.resolvePrincipal,
    stores: { default: { primary: stores } },
  });
  const who = { user: fixture.namedUser, org: fixture.namedOrg };
  const namedAddress = `${fixture.namedOrg}.${fixture.namedSeatId}`;
  const strayAddress = `${fixture.namedOrg}.${fixture.straySeatId}`;
  const namedHire = await runAction(
    namedApp,
    fixture.namedUser,
    "hire",
    { seatId: fixture.namedSeatId, instructions: fixture.namedSeatInstructions, listedAs: namedAddress },
    who,
  );
  if (namedHire.outcome !== "completed") fail("c", `named hire did not complete: ${JSON.stringify(namedHire)}`);
  const primary = await stores.resolve(["primary"]);
  await primary.resourceState!.set(
    "org",
    fixture.namedOrg,
    `workforce/roster/${fixture.tildeSeatId}`,
    toHiredSeatRow({ seatId: fixture.tildeSeatId, flow: "agent", owningOrgId: fixture.namedOrg }) as unknown as JsonObject,
    "any",
  );
  await primary.resourceState!.set(
    "org",
    fixture.namedOrg,
    `workforce/roster/${fixture.straySeatId}`,
    toHiredSeatRow({ seatId: fixture.straySeatId, flow: "agent", owningOrgId: fixture.strayOrg }) as unknown as JsonObject,
    "any",
  );
  await runAction(namedApp, fixture.namedUser, "list", { id: strayAddress }, who);

  const namedDiscover = await runAction(namedApp, fixture.namedUser, "discover", { domain: "seats" }, who);
  const namedSeats = seatsDomain(namedDiscover.outputs);
  if (namedDiscover.outcome !== "completed" || namedSeats === undefined) {
    fail("c", `named discover returned no seats domain: ${JSON.stringify(namedDiscover)}`);
  } else {
    if (namedSeats.problem !== undefined) fail("c", `${fixture.namedOrg}'s seats domain degraded to a problem: ${namedSeats.problem}`);
    const good = namedSeats.entries.find((entry) => entry.id === namedAddress);
    if (good === undefined || good.purpose !== fixture.namedSeatInstructions) {
      fail("c", `${namedAddress} was not listed with its instructions: ${JSON.stringify(namedSeats.entries)}`);
    }
    // (d) The stray row is withheld, not re-bound to the reading org.
    if (namedSeats.entries.some((entry) => entry.id === strayAddress)) {
      fail("d", `the row stamped for ${fixture.strayOrg} was listed as ${strayAddress}`);
    }
  }

  return {
    failures,
    evidence:
      `dev roster row stored under ${DEFAULT_ORG_ID}; dev discover listed ` +
      `${JSON.stringify(devSeats?.entries.map((entry) => entry.id))} with no problem; ` +
      `${fixture.namedOrg} discover listed ${JSON.stringify(namedSeats?.entries.map((entry) => entry.id))} ` +
      `with no problem, beside a "${fixture.tildeSeatId}" row and a row stamped for ${fixture.strayOrg}`,
  };
});
