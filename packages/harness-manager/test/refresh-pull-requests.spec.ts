/**
 * A run session's recorded pull requests, read again from GitHub
 * (`refreshRecordedPullRequests` on the server, the coding flow's
 * `refreshPullRequests` action, and `refreshSessionPullRequests` from a page).
 *
 * The record is written when a run sees a pull request and when its task's
 * wait on it wakes. Once the task has ended (failed, cancelled) its follow
 * ends too, so a pull request merged afterwards stayed `open` in the record for
 * good, and a screen listing it said *open* under "Open". What a person relies
 * on: a list that refreshes shows it merged (or closed), and the record keeps
 * that state; one GitHub can't answer for keeps its last sighting, and one
 * already ended is never asked about again.
 *
 * `gh` is a stub on `PATH` answering from a state the test sets, as in
 * `await-pull-requests.spec.ts`.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CollectionListPage, ResourceManifest } from "@flow-state-dev/client";
import { OBSERVED_PULL_REQUESTS, pullRequestKey, writePullRequests, type PullRequestCollection } from "@flow-state-dev/core/harness";
import type { BlockContext } from "@flow-state-dev/core/types";
import { refreshRecordedPullRequests } from "../src/await-pull-requests";
import { refreshSessionPullRequests, type RefreshPullRequestsClient } from "../src/browser";
import { REFRESH_PULL_REQUESTS } from "../src/coder-flow-name";

const PATH = process.env.PATH;
let bin: string;
let ghState: string;
let ghLog: string;

/** Each pull request's state on GitHub; a number in `fail` can't be read. */
const setGh = (state: { states: Record<number, "open" | "merged" | "closed">; fail?: number[] }) => writeFileSync(ghState, JSON.stringify(state));
const ghReads = () => readFileSync(ghLog, "utf8").split("\n").filter((line) => line !== "");

beforeAll(() => {
  bin = mkdtempSync(join(tmpdir(), "harness-manager-refresh-prs-"));
  ghState = join(bin, "state.json");
  ghLog = join(bin, "calls.log");
  writeFileSync(ghLog, "");
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = process.argv[process.argv.length - 1];
fs.appendFileSync(${JSON.stringify(ghLog)}, path + "\\n");
const state = JSON.parse(fs.readFileSync(${JSON.stringify(ghState)}, "utf8"));
const read = /pulls\\/(\\d+)$/.exec(path);
if (read === null) { process.stderr.write("unexpected gh call: " + path + "\\n"); process.exit(1); }
const n = Number(read[1]);
if ((state.fail ?? []).includes(n)) { process.stderr.write("gh: not logged in\\n"); process.exit(1); }
const s = state.states[n] ?? "open";
process.stdout.write(JSON.stringify({
  number: n, html_url: "https://github.com/acme/app/pull/" + n, title: "Pull request " + n,
  state: s === "open" ? "open" : "closed", merged: s === "merged",
  merged_at: s === "merged" ? "2026-11-28T03:03:26Z" : null,
  head: { ref: "b", sha: "abc", repo: { full_name: "acme/app" } }, base: { repo: { full_name: "acme/app" } },
}));
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  process.env.PATH = `${bin}${delimiter}${PATH ?? ""}`;
});

afterEach(() => writeFileSync(ghLog, ""));

afterAll(() => {
  process.env.PATH = PATH;
  rmSync(bin, { recursive: true, force: true });
});

/** An in-memory record collection with the slice the record's readers and writer use. */
function recordCollection() {
  const entries = new Map<string, Record<string, unknown>>();
  const collection = {
    async getOptional(key: string) {
      const state = entries.get(key);
      return state === undefined ? undefined : { state };
    },
    async upsert(key: string, patch: Record<string, unknown>) {
      entries.set(key, { ...(entries.get(key) ?? {}), ...patch });
    },
    async list() {
      return [...entries.values()].map((state) => ({ state }));
    },
  };
  return { entries, collection, ctx: { resources: { [OBSERVED_PULL_REQUESTS]: collection } } as unknown as Pick<BlockContext, "resources"> };
}

/** Record pull request `number` of acme/app as a run saw it, in `state`. */
async function seen(collection: unknown, number: number, state: "open" | "merged" | "closed") {
  await writePullRequests(
    collection as PullRequestCollection,
    [{ host: "github.com", owner: "acme", name: "app", number, url: `https://github.com/acme/app/pull/${number}`, title: `Pull request ${number}`, state }],
    { source: "tool", requestId: "req-1" },
  );
}

const key = (number: number) => pullRequestKey({ host: "github.com", owner: "acme", name: "app", number });
const OPTIONS = { cwd: tmpdir(), timeoutMs: 10_000 };

describe("refreshRecordedPullRequests", () => {
  it("writes a pull request merged since it was recorded open back as merged, keeping its run's stamp", async () => {
    const { entries, collection, ctx } = recordCollection();
    await seen(collection, 5801, "open");
    setGh({ states: { 5801: "merged" } });

    const done = await refreshRecordedPullRequests(ctx, OPTIONS);

    expect(done.read.map((pr) => [pr.number, pr.state])).toEqual([[5801, "merged"]]);
    expect(entries.get(key(5801))).toMatchObject({ state: "merged", requestId: "req-1" });
  });

  it("writes one closed without merging back as closed, and leaves one still open as open", async () => {
    const { entries, collection, ctx } = recordCollection();
    await seen(collection, 7, "open");
    await seen(collection, 8, "open");
    setGh({ states: { 7: "closed", 8: "open" } });

    await refreshRecordedPullRequests(ctx, OPTIONS);

    expect(entries.get(key(7))?.state).toBe("closed");
    expect(entries.get(key(8))?.state).toBe("open");
  });

  it("never asks GitHub again about one recorded merged or closed: neither comes back", async () => {
    const { collection, ctx } = recordCollection();
    await seen(collection, 7, "merged");
    await seen(collection, 8, "closed");
    setGh({ states: {} });

    const done = await refreshRecordedPullRequests(ctx, OPTIONS);

    expect(done.read).toEqual([]);
    expect(ghReads()).toEqual([]);
  });

  it("keeps the last sighting of one GitHub can't answer for, and still writes the others", async () => {
    const { entries, collection, ctx } = recordCollection();
    await seen(collection, 7, "open");
    await seen(collection, 8, "open");
    setGh({ states: { 8: "merged" }, fail: [7] });

    const done = await refreshRecordedPullRequests(ctx, OPTIONS);

    expect(done.unreadable.map((u) => u.key)).toEqual([key(7)]);
    expect(entries.get(key(7))?.state).toBe("open");
    expect(entries.get(key(8))?.state).toBe("merged");
  });

  it("reads nothing in a session with no record", async () => {
    expect(await refreshRecordedPullRequests({ resources: {} } as unknown as Pick<BlockContext, "resources">, OPTIONS)).toEqual({ read: [], unreadable: [] });
  });
});

/** A client over one run session's record, whose `refreshPullRequests` send runs `onRefresh` against it. */
function pageClient(record: Map<string, Record<string, unknown>>, onRefresh: () => Promise<void>) {
  const sent: Array<{ flow: string; action: string; sessionId: string }> = [];
  const manifest: ResourceManifest = {
    flowKind: "coder",
    resources: [
      { ref: OBSERVED_PULL_REQUESTS, kind: "collection", scope: "session", pattern: `${OBSERVED_PULL_REQUESTS}/**`, hasClientData: true, client: { state: { read: true } } },
    ],
  };
  const client = {
    sessions: { get: async () => ({ flowId: "coder-instance-1", flowKind: "coder" }) },
    flow: (address: string) => ({
      send: async (action: string, _input: unknown, options: { sessionId: string }) => {
        sent.push({ flow: address, action, sessionId: options.sessionId });
        const done = onRefresh();
        return { wait: async () => done };
      },
    }),
    resources: {
      getResourceManifest: async () => manifest,
      listCollectionResources: async (): Promise<CollectionListPage> => ({
        items: [...record.entries()].map(([k, data]) => ({ topic: k.slice(`${OBSERVED_PULL_REQUESTS}/`.length), clientData: data })),
      }),
    },
  } as unknown as RefreshPullRequestsClient;
  return { client, sent };
}

describe("refreshSessionPullRequests", () => {
  it("asks the run session's coding flow to read its pull requests again, then reads them merged", async () => {
    const { entries, collection, ctx } = recordCollection();
    await seen(collection, 5801, "open");
    setGh({ states: { 5801: "merged" } });
    const record = new Map<string, Record<string, unknown>>();
    const mirror = () => {
      record.clear();
      for (const [k, v] of entries) record.set(`${OBSERVED_PULL_REQUESTS}/${k}`, v);
    };
    mirror();
    const { client, sent } = pageClient(record, async () => {
      await refreshRecordedPullRequests(ctx, OPTIONS);
      mirror();
    });

    const read = await refreshSessionPullRequests(client, "dsx_run");

    expect(sent).toEqual([{ flow: "coder-instance-1", action: REFRESH_PULL_REQUESTS, sessionId: "dsx_run" }]);
    expect(read.map((pr) => [pr.number, pr.state])).toEqual([[5801, "merged"]]);
  });

  it("still reads the record as it stands when the refresh can't be sent", async () => {
    const record = new Map<string, Record<string, unknown>>([
      [`${OBSERVED_PULL_REQUESTS}/${key(7)}`, { host: "github.com", repository: "acme/app", number: 7, url: "https://github.com/acme/app/pull/7", title: "Pull request 7", state: "open" }],
    ]);
    const { client } = pageClient(record, async () => {
      throw new Error("409");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const read = await refreshSessionPullRequests(client, "dsx_run");

    expect(read.map((pr) => [pr.number, pr.state])).toEqual([[7, "open"]]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
