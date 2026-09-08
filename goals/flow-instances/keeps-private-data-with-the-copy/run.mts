/**
 * Goal check — two copies of one flow keep their private user and org data to
 * themselves, across a restart, while what they explicitly share stays shared.
 *
 * Real path, no mocking, no model, out of CI. See goal.md for the contract.
 *
 * Run: pnpm tsx goals/flow-instances/keeps-private-data-with-the-copy/run.mts
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "@flow-state-dev/engine";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { REVIEW_KIND, digestDefinition, reviewDefinition } from "./fixtures/reviewer";

type Copy = { id: string; marker: string };
type Fixture = {
  userId: string;
  orgId: string;
  shared: string;
  east: Copy;
  west: Copy;
  singleton: Copy;
};

stripIntentOverrides();

const fixture = loadFixture<Fixture>(import.meta.url);

const east = () => reviewDefinition({ id: fixture.east.id }) as unknown as FlowInstance;
const west = () => reviewDefinition({ id: fixture.west.id }) as unknown as FlowInstance;
const digest = () => digestDefinition() as unknown as FlowInstance;

function host(stores: StoreRegistry, ...flows: FlowInstance[]) {
  const registry = createFlowRegistry();
  registry.registerMany(flows);
  return createFlowApiRouter({ registry, stores, runtimeConfig: { logger: silentLogger } } as never);
}

type Router = ReturnType<typeof createFlowApiRouter>;

async function act(
  router: Router,
  address: string,
  sessionId: string,
  input: { marker: string; share: string | null },
): Promise<Response> {
  const path = [address, sessionId, "actions", "run"];
  return router.POST(
    new Request(`http://goal/api/flows/${path.join("/")}`, {
      method: "POST",
      body: JSON.stringify({ userId: fixture.userId, orgId: fixture.orgId, input }),
    }),
    { params: { path } },
  );
}

/** Every cell East owns, as one comparable snapshot. */
async function eastCells(stores: StoreRegistry): Promise<unknown> {
  const key = `${fixture.userId}:${fixture.east.id}`;
  return {
    user: (await stores.user.get(key))?.state,
    org: (await stores.org.get(`${fixture.orgId}:${fixture.east.id}`))?.state,
    resources: await stores.resourceState.getAll("user", key),
    content: await stores.content.getAll("user", key),
  };
}

async function settled(stores: StoreRegistry, requestId: string): Promise<string | undefined> {
  for (let i = 0; i < 200; i += 1) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") return record.status;
    await new Promise((r) => setTimeout(r, 25));
  }
  return undefined;
}

async function get(router: Router, path: string[]): Promise<{ status: number; body: unknown }> {
  const res = await router.GET(new Request(`http://goal/api/flows/${path.join("/")}`), {
    params: { path },
  });
  return { status: res.status, body: await res.json() };
}

/** The `/state` route's client view of the two scope-state markers. */
async function markersFromState(
  router: Router,
  sessionId: string,
): Promise<{ user: unknown; org: unknown; status: number }> {
  const { status, body } = await get(router, ["sessions", sessionId, "state"]);
  const data = (body as { clientData?: { user?: { seen?: { marker?: unknown } }; org?: { seen?: { marker?: unknown } } } })
    .clientData;
  return { status, user: data?.user?.seen?.marker, org: data?.org?.seen?.marker };
}

/** A single resource's rendered content through the public read route. */
async function content(router: Router, sessionId: string, ref: string[]): Promise<unknown> {
  const { body } = await get(router, ["sessions", sessionId, "resources", ...ref, "content"]);
  return (body as { content?: unknown }).content;
}

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "fsd-private-per-copy-"));
  const dbFile = join(dir, "goal.db");
  const sessions = { east: "s_east", west: "s_west", digest: "s_digest" };

  // ---- (a) both copies and the singleton write, through the real router --
  let stores: StoreRegistry = createSQLiteStores({ filename: dbFile }) as unknown as StoreRegistry;
  {
    const router = host(stores, east(), west(), digest());
    // East writes the shared row; West and the singleton leave it alone, so a
    // later read proves they SEE it rather than having written it themselves.
    const runs = [
      { copy: fixture.east, session: sessions.east, share: fixture.shared as string | null },
      { copy: fixture.west, session: sessions.west, share: null },
      { copy: fixture.singleton, session: sessions.digest, share: null },
    ];
    for (const { copy, session, share } of runs) {
      const res = await act(router, copy.id, session, { marker: copy.marker, share });
      const body = (await res.json()) as { request?: { id: string } };
      if (res.status !== 202) failures.push(`${copy.id}: expected 202, got ${res.status}`);
      const status = await settled(stores, body.request?.id ?? "");
      if (status !== "completed") failures.push(`${copy.id}: request ended ${status}`);
    }
    evidence.push("both copies and a singleton wrote through the HTTP action route");
  }

  // ---- (b) reopen the store and a fresh host: read everything back -------
  (stores as unknown as { close(): void }).close();
  stores = createSQLiteStores({ filename: dbFile }) as unknown as StoreRegistry;
  {
    const router = host(stores, east(), west(), digest());
    for (const { copy, session } of [
      { copy: fixture.east, session: sessions.east },
      { copy: fixture.west, session: sessions.west },
      { copy: fixture.singleton, session: sessions.digest },
    ]) {
      const seen = await markersFromState(router, session);
      if (seen.status !== 200) failures.push(`${copy.id}: /state returned ${seen.status}`);
      if (seen.user !== copy.marker || seen.org !== copy.marker) {
        failures.push(`${copy.id}: /state shows user=${String(seen.user)} org=${String(seen.org)}`);
      }
      const notes = await content(router, session, ["notes"]);
      if (notes !== `notes:${copy.marker}`) failures.push(`${copy.id}: notes content is ${String(notes)}`);
      const report = await content(router, session, ["files", "report"]);
      if (report !== `report:${copy.marker}`) failures.push(`${copy.id}: files/report content is ${String(report)}`);
      // The opt-out resource: one row, written once by East, read by all three.
      const directory = await content(router, session, ["directory"]);
      if (directory !== `directory:${fixture.shared}`) {
        failures.push(`${copy.id}: shared directory content is ${String(directory)}`);
      }
    }
    evidence.push(
      "after reopening the store, each copy read back its own scope state, resource and collection member, and all three read the one shared resource",
    );
  }

  // ---- (c) the cells on disk: private per copy, shared written once -----
  {
    const userState = async (key: string) => (await stores.user.get(key))?.state as { marker?: unknown } | undefined;
    const orgState = async (key: string) => (await stores.org.get(key))?.state as { marker?: unknown } | undefined;
    for (const copy of [fixture.east, fixture.west, fixture.singleton]) {
      const u = await userState(`${fixture.userId}:${copy.id}`);
      const o = await orgState(`${fixture.orgId}:${copy.id}`);
      if (u?.marker !== copy.marker) failures.push(`${copy.id}: user cell holds ${JSON.stringify(u)}`);
      if (o?.marker !== copy.marker) failures.push(`${copy.id}: org cell holds ${JSON.stringify(o)}`);
      const notes = await stores.resourceState.get("user", `${fixture.userId}:${copy.id}`, "notes");
      if ((notes?.state as { text?: string } | undefined)?.text !== copy.marker) {
        failures.push(`${copy.id}: notes cell holds ${JSON.stringify(notes?.state)}`);
      }
    }
    // Nothing was ever filed under the bare kind: that address is the one the
    // old key rule used, and a copy still writing there is the whole bug.
    if ((await stores.user.get(`${fixture.userId}:${REVIEW_KIND}`)) !== undefined) {
      failures.push(`a user cell exists at the bare kind ${REVIEW_KIND}`);
    }
    if ((await stores.org.get(`${fixture.orgId}:${REVIEW_KIND}`)) !== undefined) {
      failures.push(`an org cell exists at the bare kind ${REVIEW_KIND}`);
    }
    // The shared resource is one row at the bare identity id, not one per copy.
    const shared = await stores.resourceState.get("user", fixture.userId, "directory");
    if ((shared?.state as { entry?: string } | undefined)?.entry !== fixture.shared) {
      failures.push(`shared directory row holds ${JSON.stringify(shared?.state)}`);
    }
    if (shared?.version !== 1) failures.push(`shared directory was written ${shared?.version} times, expected once`);
    evidence.push(
      "on disk: one private cell per copy at its own id, nothing under the bare kind, and a single shared row written once",
    );
  }

  // ---- (d) West cannot enter East's session, and reads nothing of East's --
  {
    const router = host(stores, east(), west(), digest());
    const cellsBefore = await eastCells(stores);
    const refused = await act(router, fixture.west.id, sessions.east, {
      marker: "west-should-never-land",
      share: null,
    });
    const body = (await refused.json()) as { error?: string };
    if (refused.status !== 409 || body.error !== "wrong-instance-session") {
      failures.push(`West on East's session: expected 409 wrong-instance-session, got ${refused.status} ${body.error}`);
    }
    // A refusal that follows an effect is not a refusal: East's cells must be
    // byte-identical, not merely still present.
    if (JSON.stringify(cellsBefore) !== JSON.stringify(await eastCells(stores))) {
      failures.push("West's refused entry changed East's private data");
    }

    // And a host that never registered East cannot serve East's session at all.
    const westOnly = host(stores, west());
    const { status, body: stateBody } = await get(westOnly, ["sessions", sessions.east, "state"]);
    if (status === 200) failures.push("a West-only host served East's session state");
    if (JSON.stringify(cellsBefore) !== JSON.stringify(await eastCells(stores))) {
      failures.push("the refused read changed East's private data");
    }
    evidence.push(
      `West was refused on East's session (409 ${String(body.error)}) and a West-only host refused to read it ` +
        `(${status} ${String((stateBody as { error?: string }).error)}), with East's cells unchanged throughout`,
    );
  }

  (stores as unknown as { close(): void }).close();
  return { failures, evidence: evidence.join("; ") };
});
