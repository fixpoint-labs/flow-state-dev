/**
 * The settings a user sees on the roster (FIX-2281): a worker flow's
 * registration names them (`showSettings`), and `roster()` carries exactly
 * those, for standard workers and a user's own alike. Nothing unnamed reaches
 * a browser: the raw response text is read, not the typed client's output,
 * which drops fields it doesn't know.
 *
 * Real engine and HTTP router; nothing mocked.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "../src/workers/client";
import { checkWorkerFlows } from "../src/hire";
import { bootHost, FIXTURE, messageOf, standardWorkers } from "./worker-model-harness";
import type { WorkerManifest } from "../src/manifest";

const SECRET = "s3cr3t-token-value";

/** The harness's standard workers, with a setting on `researcher` that no flow shows. */
function withToken(): WorkerManifest[] {
  return standardWorkers().map((worker) =>
    worker.id === "researcher" ? { ...worker, declared: { ...worker.declared, apiToken: SECRET } } : worker
  );
}

/** A host, and a roster read for `userId` that also returns every response body as text. */
function host(showSettings?: string[]) {
  const stores = createInMemoryStores();
  const h = bootHost(stores, { standard: withToken(), ...(showSettings === undefined ? {} : { showSettings }) });
  const rawRoster = async (userId: string) => {
    const bodies: string[] = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await h.fetcherFor(userId)(input, init);
      bodies.push(await res.clone().text());
      return res;
    };
    const entries = await createWorkforceClient(createClient({ userId, fetcher })).roster();
    return { entries, raw: bodies.join("\n") };
  };
  return { ...h, rawRoster };
}

describe("a roster row's shown settings", () => {
  it("standard · a standard worker's row carries the settings its flow shows, and only those", async () => {
    const h = host(["tone"]);
    const { entries } = await h.rawRoster("alice");
    expect(entries.find((entry) => entry.id === "researcher")?.settings).toEqual({ tone: "formal" });
  });

  it("own · a user's fork shows its own value, read from their row", async () => {
    const h = host(["tone"]);
    expect((await h.rosterAction("alice", "fork", { from: "researcher", id: "mine" })).error).toBeUndefined();
    expect(
      (await h.rosterAction("alice", "edit", { id: "mine", settings: { tone: "terse", apiToken: SECRET } })).error
    ).toBeUndefined();
    const { entries } = await h.rawRoster("alice");
    expect(entries.find((entry) => entry.id === "mine" && !entry.standard)?.settings).toEqual({ tone: "terse" });
  });

  it("unshown · a flow that names none shows none, and a key the worker doesn't set is absent", async () => {
    const plain = host();
    const { entries } = await plain.rawRoster("alice");
    for (const entry of entries) expect(entry.settings, entry.id).toEqual({});

    // `planner` runs on a flow that shows nothing; a hire on the shown flow that sets no tone shows none.
    const shown = host(["tone"]);
    await shown.rosterAction("alice", "hire", { id: "blank", flow: FIXTURE });
    const read = (await shown.rawRoster("alice")).entries;
    expect(read.find((entry) => entry.id === "planner")?.settings).toEqual({});
    expect(read.find((entry) => entry.id === "blank")?.settings).toEqual({});
  });

  it("raw · no response a roster read receives carries an unshown setting, by name or by value", async () => {
    const h = host(["tone"]);
    await h.rosterAction("alice", "fork", { from: "researcher", id: "mine" });
    await h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE, settings: { apiToken: SECRET } });
    const { entries, raw } = await h.rawRoster("alice");
    // The read did reach both collections' rows, so an absence below means something.
    expect(entries.map((entry) => entry.id).sort()).toEqual(["mine", "planner", "researcher", "scribe"]);
    expect(raw).toContain('"formal"');
    expect(raw).not.toContain("apiToken");
    expect(raw).not.toContain(SECRET);
  });
});

describe("a flow's showSettings, checked at hire", () => {
  const stores = () => createInMemoryStores();

  it("refused · names a contract key, a reserved key, or a key the flow doesn't declare", () => {
    for (const [name, expected] of [
      ["instructions", '"instructions" is part of every worker\'s configuration'],
      ["description", '"description" is read by the hire'],
      ["colour", '"colour" is not a setting flow "fixture-worker" declares']
    ] as const) {
      const h = bootHost(stores(), { showSettings: [name] });
      let thrown: unknown;
      try {
        checkWorkerFlows(h.installation.workerFlows());
      } catch (error) {
        thrown = error;
      }
      expect(messageOf(thrown), name).toContain(expected);
    }
  });

  it("refused · a declared setting is accepted", () => {
    const h = bootHost(stores(), { showSettings: ["tone", "apiToken"] });
    expect(() => checkWorkerFlows(h.installation.workerFlows())).not.toThrow();
  });
});
