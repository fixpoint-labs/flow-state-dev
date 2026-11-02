/**
 * What a run recorded is this run's, and only this run's.
 *
 * A session keeps every request's plan, file and pull-request rows side by
 * side. A task view that showed an earlier request's files as this run's would
 * tell a person the run edited files it never touched, so the read selects by
 * the run's request, and says plainly when the flow records nothing at all.
 *
 * The client here is a store-shaped fake: it answers the manifest, filters by
 * `topicPrefix` on the full storage key, and returns each row's topic bare
 * (the collection's prefix stripped), as the resource route does. The real route is driven by
 * Shift Manager's `test/run.test.ts` against a running Lab.
 */
import type { CollectionListPage, ResourceManifest } from "@flow-state-dev/client";
import { OBSERVED_PLAN, OBSERVED_PLAN_LIST, OBSERVED_PULL_REQUESTS } from "@flow-state-dev/core/types";
import { describe, expect, it } from "vitest";
import { readRecordedWork, type RecordedWorkClient } from "../src/browser";

/** A row as the store keys it: the full storage key, collection prefix included. */
type Row = { topic: string; clientData?: unknown };

function collection(name: string) {
  return { ref: name, kind: "collection" as const, scope: "session" as const, pattern: `${name}/**`, hasClientData: true, client: { state: { read: true } } };
}

function fakeClient(rows: Record<string, Row[]>, options: { pageLimit?: number; failWith?: Error } = {}): RecordedWorkClient {
  const manifest: ResourceManifest = { flowKind: "coding", resources: Object.keys(rows).map(collection) };
  return {
    resources: {
      async getResourceManifest() {
        if (options.failWith) throw options.failWith;
        return manifest;
      },
      async listCollectionItems(_sessionId, ref, list): Promise<CollectionListPage> {
        const all = (rows[ref] ?? [])
          .filter((r) => r.topic.startsWith(list?.topicPrefix ?? ""))
          .map((r) => ({ ...r, topic: r.topic.slice(`${ref}/`.length) }));
        const limit = Math.min(list?.limit ?? all.length, options.pageLimit ?? all.length);
        return { items: all.slice(0, limit), ...(all.length > limit ? { nextCursor: "next" } : {}) };
      },
    },
  };
}

const run = { sessionId: "sess_1", requestId: "req_2" };

describe("readRecordedWork", () => {
  it("returns this request's plan, files and pull requests, never an earlier request's in the same session", async () => {
    const client = fakeClient({
      [OBSERVED_PLAN]: [
        { topic: `${OBSERVED_PLAN}/req_1/run_a/s1`, clientData: { title: "Earlier plan", status: "completed" } },
        { topic: `${OBSERVED_PLAN}/req_2/run_b/s1`, clientData: { title: "Read the task", status: "completed" } },
      ],
      [OBSERVED_PLAN_LIST]: [],
      "observed-file-ops": [
        { topic: "observed-file-ops/req_1/inv_1/old.md", clientData: { lastKind: "edited" } },
        { topic: "observed-file-ops/req_2/inv_1/notes/audit.md", clientData: { lastKind: "created" } },
        { topic: "observed-file-ops/req_2/inv_1/odd.md", clientData: { lastKind: "renamed" } },
      ],
      [OBSERVED_PULL_REQUESTS]: [
        { topic: `${OBSERVED_PULL_REQUESTS}/acme/audit/6`, clientData: { requestId: "req_1", url: "https://github.com/acme/audit/pull/6", firstSeenAt: 1 } },
        {
          topic: `${OBSERVED_PULL_REQUESTS}/acme/audit/7`,
          clientData: { requestId: "req_2", url: "https://github.com/acme/audit/pull/7", repository: "acme/audit", number: 7, title: "Audit", state: "open", source: "tool", firstSeenAt: 2 },
        },
      ],
    });
    expect(await readRecordedWork(client, run)).toEqual({
      plan: { truncated: false, rows: [{ id: "s1", title: "Read the task", status: "completed" }] },
      files: {
        truncated: false,
        rows: [
          { path: "notes/audit.md", kind: "created" },
          { path: "odd.md", kind: null },
        ],
      },
      pullRequests: {
        truncated: false,
        rows: [{ url: "https://github.com/acme/audit/pull/7", repository: "acme/audit", number: 7, title: "Audit", state: "open", source: "tool" }],
      },
    });
  });

  it("reads the plan from the conversation the run's pointer names", async () => {
    const client = fakeClient({
      [OBSERVED_PLAN]: [
        { topic: `${OBSERVED_PLAN}/conversation/conv_9/step-1`, clientData: { title: "Kept plan", status: "in_progress" } },
        { topic: `${OBSERVED_PLAN}/req_2/run_b/s1`, clientData: { title: "Run-keyed plan", status: "completed" } },
      ],
      [OBSERVED_PLAN_LIST]: [{ topic: `${OBSERVED_PLAN_LIST}/req_2/run_b`, clientData: { conversation: "conversation/conv_9" } }],
    });
    const work = await readRecordedWork(client, run);
    expect(work.plan?.rows.map((r) => r.title)).toEqual(["Kept plan"]);
  });

  it("says a section is not recorded, rather than empty, when the flow declares no collection for it", async () => {
    const client = fakeClient({ "observed-file-ops": [] });
    expect(await readRecordedWork(client, run)).toEqual({ plan: null, files: { truncated: false, rows: [] }, pullRequests: null });
  });

  it("says there is more when one page does not hold every row", async () => {
    const files = Array.from({ length: 3 }, (_, i) => ({ topic: `observed-file-ops/req_2/inv_1/f${i}.md`, clientData: { lastKind: "edited" } }));
    const work = await readRecordedWork(fakeClient({ "observed-file-ops": files }, { pageLimit: 2 }), run);
    expect(work.files).toMatchObject({ truncated: true });
    expect(work.files?.rows).toHaveLength(2);
  });

  it("throws the client's own error, for the caller to word", async () => {
    const failure = new Error("503 from the manifest route");
    await expect(readRecordedWork(fakeClient({}, { failWith: failure }), run)).rejects.toBe(failure);
  });
});
