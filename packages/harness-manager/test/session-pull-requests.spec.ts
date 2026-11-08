/**
 * `readSessionPullRequests`: the pull requests a run session's record holds,
 * as the line a task waiting on them draws (*PR open · #7*, linked).
 *
 * A waiting task's line links each pull request it waits on from this read.
 * The wait is the task's, not one request's, so the read keeps every request's
 * rows in the session (a later turn's pull request included), unlike
 * `readRecordedWork`, which keeps one run's. A row the line can't draw (no
 * number, no link) is left out, and a session that records none reads as none.
 *
 * The client is the store-shaped fake `recorded-work.spec.ts` uses.
 */
import type { CollectionListPage, ResourceManifest } from "@flow-state-dev/client";
import { OBSERVED_PULL_REQUESTS, pullRequestKey } from "@flow-state-dev/core/harness";
import { describe, expect, it } from "vitest";
import { pullRequestWait, readSessionPullRequests, type RecordedWorkClient } from "../src/browser";

type Listed = { topic: string; clientData?: unknown };

function fakeClient(rows: Listed[] | null, options: { readable?: boolean; failWith?: Error } = {}): RecordedWorkClient & { asked: string[] } {
  const asked: string[] = [];
  const manifest: ResourceManifest = {
    flowKind: "coding",
    resources:
      rows === null
        ? []
        : [
            {
              ref: OBSERVED_PULL_REQUESTS,
              kind: "collection",
              scope: "session",
              pattern: `${OBSERVED_PULL_REQUESTS}/**`,
              hasClientData: true,
              client: { state: { read: options.readable ?? true } },
            },
          ],
  };
  return {
    asked,
    resources: {
      async getResourceManifest(sessionId) {
        asked.push(sessionId);
        if (options.failWith) throw options.failWith;
        return manifest;
      },
      async listCollectionResources(_sessionId, _ref, list): Promise<CollectionListPage> {
        const items = (rows ?? [])
          .filter((r) => r.topic.startsWith(list?.topicPrefix ?? ""))
          .map((r) => ({ ...r, topic: r.topic.slice(`${OBSERVED_PULL_REQUESTS}/`.length) }));
        return { items };
      },
    },
  } as RecordedWorkClient & { asked: string[] };
}

const row = (n: number, data: Record<string, unknown>): Listed => ({ topic: `${OBSERVED_PULL_REQUESTS}/github.com/acme/app/${n}`, clientData: data });
const pr = (n: number, extra: Record<string, unknown> = {}) => ({
  host: "github.com",
  repository: "acme/app",
  number: n,
  url: `https://github.com/acme/app/pull/${n}`,
  ...extra,
});

describe("readSessionPullRequests", () => {
  it("reads every request's pull request in the session, each as the line draws it", async () => {
    const client = fakeClient([
      row(7, { ...pr(7, { title: "Fix the bug", state: "open" }), requestId: "req_1" }),
      // A later turn's: the task waits on it too.
      row(8, { ...pr(8), requestId: "req_2" }),
    ]);
    expect(await readSessionPullRequests(client, "sess_run")).toEqual([
      { host: "github.com", repository: "acme/app", number: 7, url: "https://github.com/acme/app/pull/7", title: "Fix the bug", state: "open" },
      { host: "github.com", repository: "acme/app", number: 8, url: "https://github.com/acme/app/pull/8", title: null, state: null },
    ]);
    expect(client.asked).toEqual(["sess_run"]);
  });

  it("leaves out a row the line can't draw: no number, or no link", async () => {
    const client = fakeClient([row(7, pr(7)), row(9, { ...pr(9), number: "9" }), row(10, { ...pr(10), url: null })]);
    expect((await readSessionPullRequests(client, "sess_run")).map((p) => p.number)).toEqual([7]);
  });

  it("reads none from a session that records none, or doesn't let the client read it", async () => {
    expect(await readSessionPullRequests(fakeClient(null), "sess_run")).toEqual([]);
    expect(await readSessionPullRequests(fakeClient([row(7, pr(7))], { readable: false }), "sess_run")).toEqual([]);
  });

  it("throws the client's own error, for the screen to word", async () => {
    const failure = new Error("HTTP 503");
    await expect(readSessionPullRequests(fakeClient([], { failWith: failure }), "sess_run")).rejects.toBe(failure);
  });

  it("gives pullRequestWait what links a waiting task's line", async () => {
    const task = {
      status: "in_progress",
      holds: [
        {
          id: "h1",
          openedAt: 1,
          source: { kind: "task", closedBy: [{ by: "event", event: "pull-request", key: pullRequestKey({ host: "github.com", owner: "acme", name: "app", number: 7 }) }] },
          ask: { kind: "external", prompt: "Waiting on pull request #7 to merge or close." },
        },
      ],
    };
    const records = await readSessionPullRequests(fakeClient([row(7, pr(7, { title: "Fix the bug" }))]), "sess_run");
    expect(pullRequestWait(task, records)?.pullRequests).toEqual([
      { key: pullRequestKey({ host: "github.com", owner: "acme", name: "app", number: 7 }), number: 7, url: "https://github.com/acme/app/pull/7", title: "Fix the bug" },
    ]);
  });

  // FIX-2479 D1 (BP-030): a screen hands pullRequestWait rows it never parsed (a replayed
  // stream item from before the upgrade). A wait stored under the retired `"row"` marker is
  // still the task's own, so the PR-open line stays.
  it("reads a wait a caller hands it under the retired row marker as the task's own", () => {
    const key = pullRequestKey({ host: "github.com", owner: "acme", name: "app", number: 7 });
    const task = {
      status: "in_progress",
      holds: [
        {
          id: "h1",
          openedAt: 1,
          source: { kind: "row", closedBy: [{ by: "event", event: "pull-request", key }] },
          ask: { kind: "external", prompt: "Waiting on pull request #7 to merge or close." },
        },
      ],
    };
    expect(pullRequestWait(task)).toMatchObject({ holdId: "h1", pullRequests: [{ key, number: 7 }] });
  });
});
