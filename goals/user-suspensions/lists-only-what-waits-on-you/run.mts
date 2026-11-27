/**
 * user-suspensions › lists only what waits on you (FIX-2770).
 *
 * One `createFlowState` over a SQLite file, served on a bound port. Flows: a
 * `worker` flow that asks a person (`ctx.suspendForUser`), stops for a wait
 * gate's reason and for an outside event (`ctx.suspend`), and replies in 20
 * chunks; an `other` flow that also asks; and an `inbox` flow whose user view
 * reads `sessions.userSuspensions({ flowKinds: ["worker"] })`. Every row is
 * written by a real run over HTTP, for alice in acme under tenant t1 and for
 * the people and places that aren't hers. Two rows are then made legacy on
 * purpose: one request's organization is cleared (a request with no
 * organization, which today's admission can't produce), and one request is
 * deleted (the missing-request row).
 *
 *   a:scope       the view, called over HTTP, answers exactly alice's
 *                 pending, unexpired, waiting-on-a-person asks on `worker`,
 *                 and none of the nine other rows.
 *   b:gone        a watching client (push, poll off) sees an ask answered in
 *                 another worker session leave its next pushed value, with no
 *                 refresh.
 *   c:quiet       a 20-chunk reply and a turn started and finished in another
 *                 worker session add no view call, and the view's recorded
 *                 hearing is the user topic's `suspension` kind alone.
 *   d:projection  every row's keys are inside the projection's declared set;
 *                 `stepInput`, `resumeData` and `data` are on none.
 *
 * Controls (each runs this file again with a patch applied as it loads):
 *   GOAL_CONTROL=owns-request  the SQL org match also takes a request with no
 *                              organization, as a request owner check that tolerates a missing organization would: a:scope must FAIL.
 *   GOAL_CONTROL=hear-run      the read hears `run` on the user topic instead
 *                              of `suspension`: c:quiet must FAIL.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, defineView, handler, sequencer } from "@flow-state-dev/core";
import { requestHostOf } from "@flow-state-dev/core/internal";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createClient, viewRef, type Client } from "@flow-state-dev/client";
import { watchView } from "@flow-state-dev/client/internal";
import { createFlowState } from "@flow-state-dev/engine";
import { serve, type ServeHandle } from "@flow-state-dev/node";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, modulePatchEnv, runGoal, type ModulePatch } from "../../lib/index.mts";
import { sleep } from "../../lib/time.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("user-suspensions-scope");
const BOUND_MS = 3_000;

const PATCHES: Record<string, ModulePatch[]> = {
  "owns-request": [
    { module: "packages/store-sqlite/src/suspension-store.ts", from: String.raw`AND r\.org_id IS \?`, to: "AND (r.org_id IS ? OR r.org_id IS NULL)" }
  ],
  "hear-run": [{ module: "packages/engine/src/context/view-reads.ts", from: String.raw`suspensions: \["suspension"\]`, to: 'suspensions: ["run"]' }]
};

if (CONTROL !== "" && PATCHES[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(PATCHES).join(", ")}`);
  process.exit(2);
}
if (PATCHES[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  mkdirSync(SCRATCH, { recursive: true });
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(PATCHES[CONTROL]!, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark) }
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

/** Every key a pending row may carry. */
const PROJECTION = new Set(["suspensionId", "requestId", "flowKind", "flowId", "sessionId", "kind", "shape", "title", "message", "allow", "resumeSchema", "render", "createdAt", "expiresAt"]);

const free = z.object({}).passthrough();

function workerFlow(kind: string): FlowInstance {
  const durable = (name: string, execute: Parameters<typeof handler>[0]["execute"]) =>
    sequencer({ name: `${name}-seq`, durable: true }).step(handler({ name, inputSchema: free, execute }));
  return defineFlow({
    kind,
    actions: {
      ask: {
        inputSchema: free,
        block: durable("ask", async (input, ctx) => {
          const deadline = typeof (input as { deadline?: unknown }).deadline === "number" ? { deadline: (input as { deadline: number }).deadline } : {};
          await ctx.suspendForUser({ kind: "approval", prompt: "Ship it?", title: "Ship", data: { payload: "author data" }, ...deadline });
          return { ok: true };
        })
      },
      // The reason a wait gate stores (`WAIT_GATE_REASON`), stopped for directly.
      gate: { inputSchema: free, block: durable("gate", async (_input, ctx) => (await ctx.suspend!({ reason: "wait", message: "waiting on a task" }), { ok: true })) },
      event: { inputSchema: free, block: durable("event", async (_input, ctx) => (await ctx.suspend!({ reason: "external_event", message: "waiting on a webhook" }), { ok: true })) },
      reply: {
        inputSchema: free,
        block: handler({
          name: "reply",
          inputSchema: free,
          execute: async (_input, ctx) => {
            for (let chunk = 0; chunk < 20; chunk += 1) {
              ctx.emit.message(`chunk ${chunk}`);
              await new Promise((resolve) => setTimeout(resolve, 5));
            }
            return { ok: true };
          }
        })
      }
    }
  })() as unknown as FlowInstance;
}

const inbox = defineFlow({
  kind: "inbox",
  actions: {},
  views: {
    asks: defineView({
      scope: "user",
      block: handler({
        name: "asks",
        inputSchema: z.object({}),
        // Every key passes through, so a key the projection leaked would show.
        outputSchema: z.array(z.record(z.unknown())),
        execute: async (_input, ctx) => (await requestHostOf(ctx)!.sessions!.userSuspensions({ flowKinds: ["worker"] })).suspensions
      })
    })
  }
})() as unknown as FlowInstance;

type Who = { user: string; org: string; tenant: string };
const ALICE: Who = { user: "alice", org: "acme", tenant: "t1" };
const headersOf = (who: Who) => ({ "x-user": who.user, "x-org": who.org, "x-tenant-id": who.tenant });

type Row = Record<string, unknown> & { suspensionId: string; requestId: string; flowKind: string; sessionId?: string };

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  mkdirSync(SCRATCH, { recursive: true });
  process.chdir(SCRATCH);
  const state = createFlowState({
    flows: [workerFlow("worker"), workerFlow("other"), inbox],
    stores: { default: { primary: sqliteStores({ filename: join(SCRATCH, `store-${RUN_STAMP}.sqlite`) }) } },
    resolvePrincipal: (context: { request?: Request }) => {
      const user = context.request?.headers.get("x-user");
      const org = context.request?.headers.get("x-org");
      return user && org ? { userId: user, orgId: org } : null;
    }
  } as never);
  let handle: ServeHandle | undefined;
  const stops: Array<() => void> = [];
  try {
    handle = await serve((await state.getRouter()) as never, { port: 0, host: "127.0.0.1", handleSignals: false, shutdownGraceMs: 200 });
    const base = `http://127.0.0.1:${handle.port}`;
    const stores = (await state.getRuntime()).stores;

    const post = async (who: Who, path: string, body: unknown) => {
      const response = await fetch(`${base}/api/flows/${path}`, { method: "POST", headers: { "content-type": "application/json", ...headersOf(who) }, body: JSON.stringify(body) });
      return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, any> };
    };
    /** Run `action` in `session` and wait for it to stop or finish; its request id. */
    const run = async (who: Who, flow: string, session: string, action: string, input: unknown = {}): Promise<string> => {
      const started = await post(who, `${flow}/${session}/actions/${action}`, { input });
      const requestId = started.body?.request?.id ?? started.body?.requestId;
      if (typeof requestId !== "string") throw new Error(`${flow}.${action} did not start: ${started.status} ${JSON.stringify(started.body)}`);
      for (let tries = 0; tries < 200; tries += 1) {
        const record = await stores.request.get(requestId);
        if (record !== undefined && ["suspended", "completed", "failed"].includes(record.status)) return requestId;
        await sleep(25);
      }
      throw new Error(`${flow}.${action} never settled`);
    };

    // ---------------------------------------------------------------- seed
    const mine = await run(ALICE, "worker", `w-a-${RUN_STAMP}`, "ask");
    const answerable = await run(ALICE, "worker", `w-b-${RUN_STAMP}`, "ask");
    await run({ ...ALICE, tenant: "t2" }, "worker", `w-t2-${RUN_STAMP}`, "ask");
    await run({ ...ALICE, org: "globex" }, "worker", `w-globex-${RUN_STAMP}`, "ask");
    await run({ ...ALICE, user: "bob" }, "worker", `w-bob-${RUN_STAMP}`, "ask");
    await run(ALICE, "other", `o-${RUN_STAMP}`, "ask");
    await run(ALICE, "worker", `w-gate-${RUN_STAMP}`, "gate");
    await run(ALICE, "worker", `w-event-${RUN_STAMP}`, "event");
    const expired = await run(ALICE, "worker", `w-expired-${RUN_STAMP}`, "ask", { deadline: 1 });
    const nullOrg = await run(ALICE, "worker", `w-nullorg-${RUN_STAMP}`, "ask");
    const missing = await run(ALICE, "worker", `w-missing-${RUN_STAMP}`, "ask");
    // A request with no organization: a record written before requests carried one.
    const legacy = (await stores.request.get(nullOrg))!;
    const { orgId: _cleared, ...unbound } = legacy;
    await stores.request.set(nullOrg, unbound, legacy.version);
    // A suspension whose request is gone.
    await stores.request.delete(missing);
    await sleep(50);

    const viewBody = async (who: Who) => (await post(who, "inbox/views/asks", { input: {} })).body as { output: Row[]; hears: unknown[] };

    // ---------------------------------------------------------------- a
    const first = await viewBody(ALICE);
    const listed = first.output.map((row) => row.requestId).sort();
    const want = [mine, answerable].sort();
    tell.over("a:scope · rows listed", listed);
    if (JSON.stringify(listed) !== JSON.stringify(want)) {
      failures.push(`a:scope: listed requests ${JSON.stringify(listed)}, want exactly ${JSON.stringify(want)} (null-org ${nullOrg}, missing ${missing})`);
    } else evidence.push(`a: the view listed exactly alice's 2 asks of 11 rows written`);

    // ---------------------------------------------------------------- d
    const extra = first.output.flatMap((row) => Object.keys(row).filter((key) => !PROJECTION.has(key)).map((key) => `${row.suspensionId}.${key}`));
    tell.over("d:projection · rows checked", first.output.map((row) => row.suspensionId));
    if (extra.length > 0) failures.push(`d:projection: keys outside the projection: ${extra.join(", ")}`);
    else if (JSON.stringify(first.output).includes("author data")) failures.push("d:projection: the author's data reached a row");
    else evidence.push(`d: ${first.output.length} rows carry only projection keys, no stepInput, resumeData or data`);

    // ---------------------------------------------------------------- c (the hearing)
    const hears = JSON.stringify(first.hears);
    if (hears !== JSON.stringify([{ topic: { scope: "user" }, kinds: ["suspension"] }])) failures.push(`c:quiet: the view's recorded hearing is ${hears}, not the user topic's suspension alone`);

    // A watching client: push, poll off, counting every view call.
    const calls: number[] = [];
    const client: Client = createClient({
      userId: "alice",
      baseUrl: base,
      fetcher: (input, init) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("/views/")) calls.push(Date.now());
        return fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), ...headersOf(ALICE) } });
      }
    });
    const values: Array<{ at: number; ids: string[] }> = [];
    stops.push(watchView<Row[]>(client, viewRef("inbox", "asks"), {}, { onValue: (value) => values.push({ at: Date.now(), ids: value.map((row) => row.requestId) }) }, { pollIntervalMs: null }));
    for (let waited = 0; values.length === 0 && waited < BOUND_MS; waited += 50) await sleep(50);
    await sleep(800);

    // ---------------------------------------------------------------- c (no wake on a reply)
    // The expired ask's sweep is a suspension write, and rightly wakes the
    // view: let it land before the quiet window opens.
    for (let waited = 0; waited < 15_000; waited += 100) {
      const swept = (await stores.suspensions.list({ userId: "alice" })).find((record) => record.requestId === expired);
      if (swept !== undefined && swept.status !== "pending") break;
      await sleep(100);
    }
    await sleep(800);
    const before = calls.length;
    const notices: string[] = [];
    const unhear = stores.bus!.subscribe({ scope: "user", id: "alice", tenantId: "t1" }, (notice) => notices.push(notice.kind));
    await run(ALICE, "worker", `w-chat-${RUN_STAMP}`, "reply");
    await sleep(1_500);
    unhear();
    const woke = calls.length - before;
    tell.over("c:quiet · notices on alice's user topic during the reply", notices);
    if (woke > 0) failures.push(`c:quiet: a 20-chunk reply and a turn in another session made ${woke} view calls (user topic heard: ${notices.join(",")})`);
    else if (!failures.some((f) => f.startsWith("c:quiet"))) {
      evidence.push(`c: a 20-chunk reply and its turn published ${notices.length} notices on alice's user topic (${[...new Set(notices)].join(",")}) and made 0 view calls; the view hears suspension alone`);
    }

    // ---------------------------------------------------------------- b
    const row = first.output.find((candidate) => candidate.requestId === answerable);
    if (row === undefined) failures.push("b:gone: the ask to answer was never listed");
    else {
      const from = Date.now();
      const answered = await post(ALICE, `worker/requests/${answerable}/resume`, { suspensionId: row.suspensionId, action: "approve" });
      if (answered.status >= 300) failures.push(`b:gone: the answer was refused: ${answered.status} ${JSON.stringify(answered.body)}`);
      let gone: number | undefined;
      for (let waited = 0; gone === undefined && waited < BOUND_MS; waited += 20) {
        const hit = values.find((value) => value.at >= from && !value.ids.includes(answerable));
        if (hit !== undefined) gone = hit.at - from;
        else await sleep(20);
      }
      if (gone === undefined) failures.push(`b:gone: the answered ask stayed on the watching client for ${BOUND_MS} ms`);
      else evidence.push(`b: the answered ask left the watching client's view ${gone} ms after the answer, poll off`);
    }
  } finally {
    for (const stop of stops) stop();
    await handle?.close();
    await state.dispose();
  }
  console.error(`evidence: ${evidence.join(" · ")}`);
  return { failures, evidence: evidence.join(" · ") };
});
