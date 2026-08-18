/**
 * POC — what survives to the reader, on the two routes LAB-135 reconstructs from.
 *
 * THROWAWAY. Nothing here ships. Run:
 *   pnpm tsx spec-poc/LAB-135-state-readback-surface/probe.mts
 *
 * ## The question
 *
 * LAB-135 proposes deriving a structured account of a coding run from FSD state
 * alone, grading it field by field rather than by substring over rendered text
 * (FIX-1184). The whole design rests on three premises about what a *reader* on
 * the far side of the HTTP routes actually receives:
 *
 *   1. a persisted `tool_output` item still carries `toolCall.name` and a
 *      parseable `toolCall.arguments`, so the file a run wrote is a FIELD and
 *      not a substring of prose;
 *   2. the ordering key on a persisted item is `itemIndex` (a goal check in
 *      this epic asserted ordering on `seq`, a field persisted items do not
 *      carry, and reported PASS over zero evidence — FIX-1183);
 *   3. the collection-state route's envelope, and its 403 without
 *      `client.state.read`.
 *
 * ## What is real here, and what is scripted
 *
 * Real: the emitter (`emitTranslatedEvent`), the translation layer
 * (`translateSdkMessage`), a real `createFlowState` runtime, a real `serve()`
 * host, `@flow-state-dev/store-sqlite`, and the shipped HTTP routes. The
 * readback crosses a real persistence boundary and a real route.
 *
 * Scripted: the SDK messages. They are transcribed from the shapes LAB-134's
 * POC measured off four real `claude` 2.1.234 runs. So the conclusions below are
 * scoped to *persistence and readback* — this probe measures nothing about what
 * the harness emits, which LAB-134's POC measured and this one takes as given.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// `spec-poc/` is deliberately NOT a workspace package (see spec-poc/README.md),
// so it has no `@flow-state-dev/*` links. Import each package by its source
// path; their own internal imports resolve through their own node_modules.
import { defineFlow, defineResourceCollection, handler } from "../../packages/core/src/index";
import { z } from "../../packages/core/node_modules/zod";
import {
  createTranslateState,
  translateSdkMessage,
} from "../../packages/claude-code/src/sdk/translate";
import { createEmitState, emitTranslatedEvent } from "../../packages/claude-code/src/sdk/emit";

const FLOW_KIND = "poc-readback";
const USER_ID = "poc-user";
const SESSION_ID = `sess_poc_${Date.now()}`;

/**
 * SDK messages transcribed from LAB-134's POC output — a `Write` and an `Edit`
 * with their results, plus a failing `Edit`. Two turns, so ordering across
 * turns is observable.
 */
const SCRIPTED = [
  {
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "I'll create the module first." },
        {
          type: "tool_use",
          id: "toolu_01AAA",
          name: "Write",
          input: { file_path: "/tmp/poc/src/usage.ts", content: "export const x = 1;\n" },
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_01AAA",
          content: "File created successfully at: /tmp/poc/src/usage.ts",
        },
      ],
    },
  },
  {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "toolu_01BBB",
          name: "Edit",
          input: {
            file_path: "/tmp/poc/src/result.ts",
            old_string: "a",
            new_string: "b",
            replace_all: false,
          },
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_01BBB",
          content: "String to replace not found in file.",
          is_error: true,
        },
      ],
    },
  },
] as const;

/** Visible to a client reader: declares state reads. */
const visibleOps = defineResourceCollection({
  pattern: "poc-visible/**",
  scope: "session",
  stateSchema: z.object({
    lastKind: z.string().default(""),
    ok: z.boolean().default(true),
  }),
  client: { state: { read: true } },
});

/** Identical, minus the declaration — the control for premise 3. */
const hiddenOps = defineResourceCollection({
  pattern: "poc-hidden/**",
  scope: "session",
  stateSchema: z.object({ lastKind: z.string().default("") }),
});

const driveRun = handler({
  name: "poc-drive-run",
  inputSchema: z.object({}),
  outputSchema: z.object({ emitted: z.number() }),
  resources: { visibleOps, hiddenOps },
  execute: async (_input, ctx: any) => {
    // Drive the REAL translation + emission path with the scripted messages.
    const translateState = createTranslateState({ partialMessages: false });
    const emitState = createEmitState();
    let emitted = 0;
    for (const msg of SCRIPTED) {
      for (const event of translateSdkMessage(msg as never, translateState)) {
        await emitTranslatedEvent(event, ctx, emitState, "poc-agent");
        emitted += 1;
      }
    }
    // One row in each collection, so the route has something to return.
    await ctx.resources.visibleOps.create("run1/src/usage.ts", { lastKind: "created", ok: true });
    await ctx.resources.hiddenOps.create("run1/src/usage.ts", { lastKind: "created" });
    return { emitted };
  },
});

const flow = defineFlow({
  kind: FLOW_KIND,
  resources: { visibleOps, hiddenOps },
  actions: { drive: { block: driveRun } },
})({ id: "default" });

function noModel(): never {
  throw new Error("poc: this flow declares no generator actions");
}

const workDir = mkdtempSync(join(tmpdir(), "lab135-poc-"));
const dbFile = join(workDir, "poc.sqlite");

const { createFlowState } = await import("../../packages/engine/src/index");
const { sqliteStores } = await import("../../packages/store-sqlite/src/index");
const { serve } = await import("../../packages/node/src/index");

const flowstate = createFlowState({
  flows: { [FLOW_KIND]: flow },
  modelResolver: Object.assign(noModel, { resolveId: noModel }) as never,
  stores: { prod: { primary: sqliteStores({ filename: dbFile }) } },
  defaultProfile: "prod",
  logger: { debug() {}, info() {}, warn() {}, error() {} },
} as never);

const host = await serve(flowstate as never, { port: 0, host: "127.0.0.1" });
const base = `http://127.0.0.1:${host.port}/api/flows`;

const line = (s: string) => console.log(s);
const rule = () => line("─".repeat(78));

try {
  const res = await fetch(`${base}/${FLOW_KIND}/actions/drive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: {}, userId: USER_ID, sessionId: SESSION_ID }),
  });
  line(`dispatch: HTTP ${res.status}`);
  if (res.status >= 400) {
    line(await res.text());
    throw new Error("dispatch failed");
  }

  // ── Premise 1 + 2: the item stream, as a reader receives it ───────────────
  rule();
  line("PREMISE 1+2 — GET /sessions/:id/requests?include_items=true");
  rule();
  const reqBody: any = await (
    await fetch(`${base}/sessions/${SESSION_ID}/requests?include_items=true`)
  ).json();
  const items: any[] = (reqBody?.requests ?? []).flatMap((r: any) => r.items ?? []);
  line(`items returned: ${items.length}`);
  line(`item types:     ${JSON.stringify(items.map((i) => i.type))}`);

  const tools = items.filter((i) => i.type === "tool_output");
  line(`tool_output items: ${tools.length}`);
  for (const t of tools) {
    line("");
    line(`  status        = ${JSON.stringify(t.status)}`);
    line(`  itemIndex     = ${JSON.stringify(t.itemIndex)}   (typeof ${typeof t.itemIndex})`);
    line(`  seq           = ${JSON.stringify(t.seq)}   <-- the field FIX-1183 was read on`);
    line(`  blockName     = ${JSON.stringify(t.blockName)}`);
    line(`  toolCall.name = ${JSON.stringify(t.toolCall?.name)}`);
    line(`  toolCall.arguments (raw)   = ${JSON.stringify(t.toolCall?.arguments)}`);
    let parsed: unknown = "<<UNPARSEABLE>>";
    try {
      parsed = JSON.parse(t.toolCall?.arguments);
    } catch {
      /* leave the marker */
    }
    line(`  toolCall.arguments (parsed) = ${JSON.stringify(parsed)}`);
    line(
      `  -> file_path as a FIELD     = ${JSON.stringify((parsed as any)?.file_path ?? null)}`,
    );
    line(`  output        = ${JSON.stringify(t.output)}`);
    line(`  provenance    = ${JSON.stringify(t.provenance)}`);
  }

  const idx = items.map((i) => i.itemIndex);
  const seqs = items.map((i) => i.seq).filter((s) => typeof s === "number");
  line("");
  line(`ordering: itemIndex values = ${JSON.stringify(idx)}`);
  line(`ordering: seq values       = ${JSON.stringify(seqs)}  (length ${seqs.length})`);
  line(
    `VERDICT ordering: itemIndex usable = ${idx.every((v) => typeof v === "number")}; ` +
      `seq usable = ${seqs.length > 0}`,
  );

  // Print one item verbatim so the exact envelope is on the record.
  rule();
  line("one tool_output item, verbatim:");
  line(JSON.stringify(tools[0], null, 2));

  // ── Premise 3: the collection-state route ─────────────────────────────────
  rule();
  line("PREMISE 3 — GET /sessions/:id/resources/:ref");
  rule();
  // The route addresses a collection by its ACCESSOR KEY on the flow
  // (`findResourceConfig`), not by its pattern.
  for (const ref of ["visibleOps", "hiddenOps"]) {
    const r = await fetch(`${base}/sessions/${SESSION_ID}/resources/${ref}`);
    const body = await r.text();
    line(`  ${ref.padEnd(12)} HTTP ${r.status}  ${body.slice(0, 300)}`);
  }
  rule();
  line("page size: STATE_LIST_DEFAULT_LIMIT=50, max=200, `nextCursor` when more remain");
} finally {
  await host.close();
  rmSync(workDir, { recursive: true, force: true });
}
