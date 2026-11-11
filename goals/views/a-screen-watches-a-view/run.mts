/**
 * views › a screen watches a view (FIX-2623).
 *
 * One `serve()` host on a bound port, built by the conversation-board test
 * host (workforce's roster flow, the coordinator flow and its workers) plus a
 * probe flow, one user behind a verified header. A real client (Node's
 * `fetch` and `WebSocket`) watches three views with its poll off, and its
 * fetcher counts every view call:
 *
 *   - the roster view (user scope, no session), through `watchRoster`;
 *   - the conversation board (`listTasks_tasks`, a session view), through `watchView`;
 *   - the probe view, whose only read is one user collection, one block down
 *     in a sequencer step (FIX-2621's probe), through `watchView`.
 *
 *   a  — the roster view answers a user who never had a session, equal to the
 *        roster read through a roster session for the same data, and the
 *        session store lists the same before and after.
 *   b  — another client hires a worker, files a task and writes the probe:
 *        each reaches the watching client under 1 s. A second user's hire
 *        reaches no one watching the first. Then 10 s idle: 0 view calls.
 *   c  — no removed name on any root, and the glossary's "read" check fails
 *        a planted `reads:`. Red until the PR that removes `reads` (PR 5).
 *
 * Control (runs this file again with a patch applied as it loads):
 *   GOAL_CONTROL=blind-child  the recorder skips reads made by child blocks:
 *                             b must FAIL on the probe write.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, defineResourceCollection, defineView, handler, sequencer } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createClient, readEveryCollectionPage, viewRef, type Client } from "@flow-state-dev/client";
import { watchView } from "@flow-state-dev/client/internal";
import { serve, type ServeHandle } from "@flow-state-dev/node";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, modulePatchEnv, runGoal, type ModulePatch } from "../../lib/index.mts";
import { bootBoardHost } from "../../../packages/workforce/test/conversation-board-harness.ts";
import { createWorkforceClient, type RosterEntry } from "../../../packages/workforce/src/workers/client.ts";
import { rosterView } from "../../../packages/workforce/src/workers/roster-view-ref.ts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("views-screen-watches");
const BOUND_MS = 1_000;
const IDLE_MS = 10_000;
const CONTEXT = "packages/engine/src/context/createExecutionContext.ts";

const PATCHES: Record<string, ModulePatch[]> = {
  // The recorder skips a read made by any block but the view's own: a read
  // whose block instance path (`<request>:<path>:<attempt>`) goes below root.
  "blind-child": [
    {
      module: CONTEXT,
      from: String.raw`    recordResource\(name\);\n    return handle;`,
      to: '    { const at = loadAttributionStorage.getStore(); if (at === undefined || !String(at).split(":")[1]?.includes("/")) recordResource(name); }\n    return handle;'
    }
  ]
};

if (CONTROL !== "" && PATCHES[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(PATCHES).join(", ")}`);
  process.exit(2);
}
if (PATCHES[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(PATCHES[CONTROL]!, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark) }
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

// ---------------------------------------------------------------------------
// The probe: a view whose only read is one user collection, one block down.
// ---------------------------------------------------------------------------

const notes = defineResourceCollection({ scope: "user", pattern: "probe-notes/*", stateSchema: z.object({ label: z.string() }) });

function probeFlow(): FlowInstance {
  const countStep = handler({
    name: "count-notes",
    inputSchema: z.unknown(),
    outputSchema: z.object({ count: z.number() }),
    resources: { notes },
    execute: async (_input, ctx) => ({ count: (await ctx.resources.notes.list()).length })
  });
  return defineFlow({
    kind: "probe",
    actions: {
      write: {
        inputSchema: z.object({ label: z.string() }),
        block: handler({
          name: "write-note",
          inputSchema: z.object({ label: z.string() }),
          resources: { notes },
          execute: async (input, ctx) => {
            await ctx.resources.notes.create(input.label, { label: input.label });
            return { ok: true };
          }
        })
      }
    },
    views: { probe: defineView({ scope: "user", block: sequencer({ name: "probe", inputSchema: z.object({}) }).step(countStep) }) }
  })() as unknown as FlowInstance;
}

type Call = { at: number; url: string };

/** `userId`'s client against `base`, counting every view call it makes. */
function clientOf(base: string, userId: string): { client: Client; views: Call[] } {
  const views: Call[] = [];
  const client = createClient({
    userId,
    baseUrl: base,
    fetcher: (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/views/")) views.push({ at: Date.now(), url });
      return fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), "x-user": userId } });
    }
  });
  return { client, views };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function firstAt<T>(seen: Array<{ at: number; value: T }>, match: (value: T) => boolean, from: number, withinMs: number): Promise<number | undefined> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const hit = seen.find((entry) => entry.at >= from && match(entry.value));
    if (hit !== undefined) return hit.at;
    if (Date.now() > deadline) return undefined;
    await delay(10);
  }
}

async function quiet(lists: Array<{ at: number }[]>, quietMs = 800): Promise<void> {
  for (;;) {
    const last = Math.max(0, ...lists.map((list) => list[list.length - 1]?.at ?? 0));
    const wait = last + quietMs - Date.now();
    if (wait <= 0) return;
    await delay(wait);
  }
}

/** Today's roster for the same data: the two worker collections read through a roster session. */
async function legacyRoster(client: Client): Promise<Array<{ id: string; flow: string; standard: boolean }>> {
  const session = await client.flow("workforce-roster").createSession();
  const [own, standard] = await Promise.all([
    readEveryCollectionPage(client.resources, session.id, "workforceWorkers"),
    readEveryCollectionPage(client.resources, session.id, "workforceStandardWorkers")
  ]);
  const entry = (item: { topic: string; clientData?: unknown }, isStandard: boolean) => ({
    id: item.topic.slice(item.topic.lastIndexOf("/") + 1),
    flow: String((item.clientData as { flow?: unknown } | undefined)?.flow),
    standard: isStandard
  });
  const standardIds = new Set(standard.map((item) => entry(item, true).id));
  // A standard worker the user edited is listed once, as standard.
  return [...own.map((item) => entry(item, false)).filter((e) => !standardIds.has(e.id)), ...standard.map((item) => entry(item, true))];
}

// Leg a's claim is "the same workers, with no session": which workers, on which
// flow, standard or not. Full row parity (names, teams, settings, the edited
// copy's projection) is out of its scope: workforce's roster tests
// (worker-roster.test.ts, roster-shown-settings.test.ts) hold the row contents,
// read through the view.
const shape = (entries: ReadonlyArray<{ id: string; flow: string; standard: boolean }>) =>
  entries.map(({ id, flow, standard }) => `${id}:${flow}:${standard}`).sort();

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const host = bootBoardHost({ plainFlows: { probe: probeFlow() } });
  let handle: ServeHandle | undefined;
  const stops: Array<() => void> = [];
  try {
    handle = await serve((await host.router()) as never, { port: 0, host: "127.0.0.1", handleSignals: false, shutdownGraceMs: 200 });
    const base = `http://127.0.0.1:${handle.port}`;
    const stores = (await host.state.getRuntime()).stores;
    const watcher = clientOf(base, "alice");
    const writer = clientOf(base, "alice").client;

    // ------------------------------------------------------------------ a
    {
      const before = (await stores.session.list({})).map((s) => s.id).sort();
      const answer = await watcher.client.view(rosterView);
      const after = (await stores.session.list({})).map((s) => s.id).sort();
      const hadSession = (await stores.session.list({})).some((s) => s.userId === "alice" && before.includes(s.id));
      const today = await legacyRoster(writer);
      const same = JSON.stringify(shape(answer.value)) === JSON.stringify(shape(today));
      tell.over("a:no-session · roster rows", answer.value.map((entry) => entry.id));
      if (JSON.stringify(before) !== JSON.stringify(after)) failures.push(`a:no-session: the session store changed: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      if (hadSession) failures.push("a:no-session: alice had a session before the view, so the check proves nothing");
      if (!same) failures.push(`a:no-session: the roster view ${JSON.stringify(shape(answer.value))} differs from today's roster ${JSON.stringify(shape(today))}`);
      if (answer.value.length === 0) failures.push("a:no-session: the roster view answered no worker");
      if (same && JSON.stringify(before) === JSON.stringify(after) && answer.value.length > 0) {
        evidence.push(`a: roster view answered ${answer.value.length} workers for a user with no session, equal to today's roster; session store unchanged (${before.length})`);
      }
    }

    // ------------------------------------------------------------------ b
    {
      const conversation = await host.conversation("alice", "lead");
      const roster: Array<{ at: number; value: RosterEntry[] }> = [];
      const board: Array<{ at: number; value: { tasks?: Array<{ id: string }> } }> = [];
      const probe: Array<{ at: number; value: { count: number } }> = [];
      stops.push(createWorkforceClient({ ...watcher.client }).watchRoster((value) => roster.push({ at: Date.now(), value })));
      stops.push(
        watchView<{ tasks?: Array<{ id: string }> }>(watcher.client, viewRef("coordinator", "listTasks_tasks"), {}, { onValue: (value) => board.push({ at: Date.now(), value }) }, { sessionId: conversation, pollIntervalMs: null })
      );
      stops.push(watchView<{ count: number }>(watcher.client, viewRef("probe", "probe"), {}, { onValue: (value) => probe.push({ at: Date.now(), value }) }, { pollIntervalMs: null }));
      await delay(1_500);
      await quiet([watcher.views]);
      if (roster.length === 0 || board.length === 0 || probe.length === 0) failures.push("b:within-1s: a watch never answered at start");

      // Each clock starts before its write is sent and the search runs from
      // there, so a value that lands while the write's call is still
      // returning is found, and the latency is an upper bound that includes
      // the write itself: it can't read below 0, and a slow one fails.
      const lat: Record<string, number | undefined> = {};
      // A hire, from another client.
      const hireFrom = Date.now();
      await createWorkforceClient(writer).hire({ id: "scribe", flow: "tasker", description: "Takes notes." });
      const hire = await firstAt(roster, (v) => v.some((e) => e.id === "scribe"), hireFrom, 3_000);
      lat.hire = hire === undefined ? undefined : hire - hireFrom;
      // A filed task, from another client, into the watched conversation.
      const fileFrom = Date.now();
      await (await writer.flow("coordinator").send("createTask_tasks", { goal: "Audit licenses", assignee: "eng.tasker", held: true }, { sessionId: conversation })).wait();
      const filed = await firstAt(board, (v) => (v.tasks ?? []).length > 0, fileFrom, 3_000);
      lat["filed task"] = filed === undefined ? undefined : filed - fileFrom;
      // A probe write, from another client.
      const writeFrom = Date.now();
      await (await writer.flow("probe").send("write", { label: "first" })).wait();
      const wrote = await firstAt(probe, (v) => v.count > 0, writeFrom, 3_000);
      lat["probe write"] = wrote === undefined ? undefined : wrote - writeFrom;

      tell.over("b:within-1s · latency per change", Object.values(lat).filter((v): v is number => v !== undefined));
      for (const [what, ms] of Object.entries(lat)) {
        if (ms === undefined) failures.push(`b:within-1s: the ${what} never reached the watching client within 3 s`);
        else if (ms >= BOUND_MS) failures.push(`b:within-1s: the ${what} reached it ${ms} ms after the write (bound ${BOUND_MS})`);
      }
      if (Object.values(lat).every((ms) => ms !== undefined && ms < BOUND_MS)) {
        evidence.push(`b: from each write's start, ${Object.entries(lat).map(([what, ms]) => `${what} ${ms} ms`).join(", ")}`);
      }

      // A second user's change reaches no one watching the first.
      await quiet([watcher.views]);
      const beforeBob = watcher.views.length;
      await createWorkforceClient(clientOf(base, "bob").client).hire({ id: "bobs", flow: "tasker" });
      await delay(BOUND_MS);
      const bobWoke = watcher.views.length - beforeBob;
      if (bobWoke > 0) failures.push(`b:within-1s: a second user's hire woke ${bobWoke} of alice's view calls`);
      else evidence.push("b: a second user's hire reached none of alice's watches");

      // Idle.
      await quiet([watcher.views]);
      const idleFrom = watcher.views.length;
      await delay(IDLE_MS);
      const idle = watcher.views.length - idleFrom;
      tell.over("b:idle-0-reads · view calls over 10 s idle", [idle]);
      if (idle > 0) failures.push(`b:idle-0-reads: ${idle} view calls over ${IDLE_MS / 1000} s idle`);
      else evidence.push(`b: 0 view calls over ${IDLE_MS / 1000} s idle across the three watches`);
    }

    // ------------------------------------------------------------------ c
    {
      // Removed names: none may remain on a root once reads and `derived` are gone.
      const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
      const remaining = [
        ["core root ReadConfig", /\bReadConfig\b/.test(read("packages/core/src/index.ts"))],
        ["engine internal runRead", /\brunRead\b/.test(read("packages/engine/src/internal.ts"))],
        ["client flow().read", /\n\s+read<TOutput/.test(read("packages/client/src/client.ts"))],
        ["flow reads", /\breads\?: Record<string, ReadEntry>/.test(read("packages/core/src/types/flow.ts"))],
        ["scope derived", /\bderived\?: Record<string, ClientDataComputeFn/.test(read("packages/core/src/types/flow.ts"))]
      ].filter(([, present]) => present).map(([name]) => name as string);
      tell.over("c:inventory · removed names still exported", remaining, { emptyIs: "the claim: no removed name remains on a root" });
      if (remaining.length > 0) failures.push(`c:inventory: still exported: ${remaining.join(", ")} (removed by FIX-2623's PR 4 and PR 5)`);
      else evidence.push("c: no removed name on any root");
    }
  } finally {
    for (const stop of stops) stop();
    await handle?.close();
    await host.dispose();
  }
  // The legs that passed, shown even when another leg failed (c is red until PR 5).
  console.error(`evidence: ${evidence.join(" · ")}`);
  return { failures, evidence: evidence.join(" · ") };
});
