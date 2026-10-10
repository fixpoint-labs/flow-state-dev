/**
 * Goal check — an oversized return stays out of the record, and a resume never
 * computes from what the record left out.
 *
 * Real path, no mocking, no model, out of CI. See goal.md for the contract.
 *
 * Drives a real flow router over a SQLite store, the way a client does:
 *   POST .../actions/run          → a step (one flow) or a tool (another) returns 1 MB, then a pause
 *   read the SQLite store         → no saved item holds the held-out marker or is over 300 KiB
 *   POST .../requests/:id/resume  → the resumed request fails with RECORDED_VALUE_OMITTED, naming the step
 * and a third flow that passes the same 1 MB through a middle `.map`, which
 * must save none of it and resume to the full payload's digest.
 *
 * Controls:
 *   GOAL_CONTROL=no-limit            the limit set past the payload: the marker reaches the store
 *   GOAL_CONTROL=replay-placeholder  the saved placeholders rewritten as plain values before
 *                                    resume, as a runtime that replayed them would see them:
 *                                    the resumed requests complete instead of failing
 *
 * Run: pnpm tsx goals/oversized-output/stays-out-of-the-record/run.mts
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import {
  createCheckpointDurabilityProvider,
  createFlowApiRouter,
  createFlowRegistry,
  type StoreRegistry
} from "@flow-state-dev/engine";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { z } from "zod";
import { loadFixture, runGoal, silentLogger } from "../../lib/index.mts";

const fixture = loadFixture<{ bodyBytes: number; limitBytes: number }>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
// Held out: a fresh marker each run, so nothing can be hardcoded against it.
const MARKER = `held-out-${randomUUID()}`;
const USER = "u_goal";

type Bulk = { files: Array<{ path: string; body: string }> };
const bulk = (bytes: number): Bulk => ({ files: [{ path: "src/index.ts", body: `${"x".repeat(bytes)}${MARKER}` }] });
const digestOf = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// ---- the flows -----------------------------------------------------------

const readAll = handler({
  name: "readAll",
  inputSchema: z.object({ bytes: z.number() }),
  outputSchema: z.any(),
  execute: (input) => bulk(input.bytes)
});
const approve = handler({
  name: "approve",
  inputSchema: z.any(),
  outputSchema: z.any(),
  execute: async (input, ctx) => {
    await ctx.suspend!({ reason: "human_approval", message: "Approve?" });
    return input;
  }
});
const digest = handler({
  name: "digest",
  inputSchema: z.any(),
  outputSchema: z.object({ digest: z.string() }),
  execute: (input: unknown) => ({ digest: digestOf(input) })
});
const sizeOnly = handler({
  name: "sizeOnly",
  inputSchema: z.object({ bytes: z.number() }),
  outputSchema: z.object({ bytes: z.number() }),
  execute: (input) => ({ bytes: input.bytes })
});

const durableFlow = (id: string, block: Parameters<typeof defineFlow>[0]["actions"]["run"]["block"]) =>
  defineFlow({ kind: id, actions: { run: { block, inputSchema: z.object({ bytes: z.number() }) } } })({ id }) as unknown as FlowInstance;

/** Misuse: a step returns the whole payload, then a pause, then a step that uses it. */
const stepFlow = durableFlow("oversized-step", sequencer({ name: "stepFlow", durable: true }).step(readAll).step(approve).step(digest));
/** Misuse: a tool returns the whole payload. */
const toolFlow = durableFlow(
  "oversized-tool",
  sequencer({ name: "toolFlow", durable: true }).step(readAll.asTool()).step(approve).step(digest)
);
/** The sanctioned seam: the payload is built in a middle `.map`, after the pause. */
const seamFlow = durableFlow(
  "oversized-seam",
  sequencer({ name: "seamFlow", durable: true })
    .step(sizeOnly)
    .step(approve)
    .map((v: { bytes: number }) => bulk(v.bytes))
    .step(digest)
);

// ---- the host ------------------------------------------------------------

type Router = ReturnType<typeof createFlowApiRouter>;
type Provider = ReturnType<typeof createCheckpointDurabilityProvider>;

function host(stores: StoreRegistry): { router: Router; provider: Provider } {
  const registry = createFlowRegistry();
  registry.registerMany([stepFlow, toolFlow, seamFlow]);
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases
  });
  const maxRecordedValueBytes = CONTROL === "no-limit" ? Number.MAX_SAFE_INTEGER : fixture.limitBytes;
  const router = createFlowApiRouter({
    registry,
    stores,
    runtimeConfig: { logger: silentLogger, durabilityProvider: provider, maxRecordedValueBytes }
  } as never);
  return { router, provider };
}

async function post(router: Router, segs: string[], body: unknown): Promise<{ status: number; json: any }> {
  const res = await router.POST(
    new Request(`http://goal/api/flows/${segs.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }),
    { params: { path: segs } }
  );
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: text };
  }
}

async function settle(stores: StoreRegistry, requestId: string, done: (status: string) => boolean) {
  for (let i = 0; i < 400; i += 1) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && done(record.status)) return record;
    await new Promise((r) => setTimeout(r, 25));
  }
  return stores.request.get(requestId);
}

/**
 * The replay-placeholder control: rewrite each saved placeholder as a plain
 * value, which is what a runtime that replayed the record as data would see.
 */
async function rewritePlaceholdersAsValues(stores: StoreRegistry, requestId: string): Promise<void> {
  const record = await stores.request.get(requestId);
  if (record === undefined) return;
  const items = (record.items ?? []).map((item) => {
    const it = item as Record<string, any>;
    if (it.type === "block_trace" && it.output?.kind === "omitted") {
      return { ...it, output: { kind: "inline", value: it.output } };
    }
    if (it.type === "tool_output" && it.outputOmitted !== undefined) {
      const { outputOmitted, ...rest } = it;
      return { ...rest, output: outputOmitted };
    }
    return it;
  });
  stores.request.persistItems(requestId, items as never);
  await stores.request.flushItems(requestId);
}

/** Dispatch, wait for the pause, then resume over HTTP and wait for the end. */
async function pauseThenResume(router: Router, stores: StoreRegistry, provider: Provider, flowId: string) {
  const sent = await post(router, [flowId, `s_${flowId}`, "actions", "run"], { userId: USER, input: { bytes: fixture.bodyBytes } });
  const requestId: string = sent.json?.request?.id ?? sent.json?.requestId;
  const paused = await settle(stores, requestId, (s) => s !== "in_progress" && s !== "queued");
  const saved = ((await stores.request.get(requestId))?.items ?? []) as unknown[];
  if (CONTROL === "replay-placeholder") await rewritePlaceholdersAsValues(stores, requestId);
  const pending = (await provider.listSuspended({ status: "pending" })).find((s) => s.requestId === requestId);
  const resumed =
    pending === undefined
      ? undefined
      : await post(router, [flowId, "requests", requestId, "resume"], {
          suspensionId: pending.suspensionId,
          action: "approve",
          resumedBy: USER
        });
  const end = await settle(stores, requestId, (s) => s === "completed" || s === "failed");
  const after = (end?.items ?? []) as unknown[];
  return { pausedStatus: paused?.status, saved, after, resumeHttp: resumed?.status, end };
}

const holdingMarker = (items: unknown[]) => items.filter((i) => JSON.stringify(i).includes(MARKER));
const largestBytes = (items: unknown[]) => Math.max(0, ...items.map((i) => Buffer.byteLength(JSON.stringify(i), "utf8")));

// ---- the check -----------------------------------------------------------

await runGoal(async (failures) => {
  const dir = mkdtempSync(join(tmpdir(), "fsd-oversized-output-"));
  const stores = createSQLiteStores({ filename: join(dir, "goal.db") }) as unknown as StoreRegistry;
  const { router, provider } = host(stores);
  const evidence: string[] = [];

  // ---- the misuse legs: a step, and a tool --------------------------------
  for (const [flowId, stepName] of [["oversized-step", "readAll"], ["oversized-tool", "readAll"]] as const) {
    const r = await pauseThenResume(router, stores, provider, flowId);
    if (r.pausedStatus !== "suspended") failures.push(`${flowId}: expected a pause, got ${r.pausedStatus}`);

    const holding = holdingMarker(r.saved);
    if (holding.length > 0) {
      failures.push(
        `${flowId}: no saved item contains the marker — ${holding.length} do (${holding.map((i) => (i as { type: string }).type).join(", ")})`
      );
    }
    const largest = largestBytes(r.saved);
    if (largest > 300 * 1024) failures.push(`${flowId}: no saved item is over 300 KiB — the largest is ${largest} bytes`);

    const error = (r.end?.result as { error?: { code?: string; message?: string } } | undefined)?.error;
    if (r.end?.status !== "failed" || error?.code !== "RECORDED_VALUE_OMITTED") {
      failures.push(
        `${flowId}: the resumed request ends failed with RECORDED_VALUE_OMITTED — it ended ${r.end?.status} ` +
          `(${error?.code ?? "no error code"}; resume HTTP ${r.resumeHttp})`
      );
    } else if (!String(error.message).includes(stepName)) {
      failures.push(`${flowId}: the resume error names the step — ${error.message}`);
    }
    evidence.push(
      `${flowId}: paused with ${r.saved.length} saved items, none holding the marker, largest ${largest} B; ` +
        `resume (HTTP ${r.resumeHttp}) ended ${r.end?.status} with ${error?.code}`
    );
  }

  // ---- the sanctioned seam ------------------------------------------------
  const seam = await pauseThenResume(router, stores, provider, "oversized-seam");
  const expected = digestOf(bulk(fixture.bodyBytes));
  const got = (seam.end?.result as { output?: { digest?: string } } | undefined)?.output?.digest;
  if (seam.end?.status !== "completed" || got !== expected) {
    failures.push(`oversized-seam: the resumed request completes with the full payload's digest — ${seam.end?.status}, ${got}`);
  }
  if (holdingMarker(seam.after).length > 0) failures.push("oversized-seam: a middle .map's payload was saved");
  evidence.push(`oversized-seam: resumed to the full payload's digest and saved none of it (${seam.after.length} items)`);

  (stores as unknown as { close?: () => void }).close?.();
  return { failures, evidence: evidence.join("; ") };
});
