/**
 * Runs inside the consumer project for `types.fresh-session-default`: scope
 * state defaults on the installed tarballs, and the refusal of declarations
 * that disagree.
 *
 * Cases, each a check of its own:
 *
 *   - **reads**: on a real server (`@flow-state-dev/node` over
 *     `@flow-state-dev/engine`), the first request of a fresh session reads,
 *     in its handler, the default of a field the flow's session `stateSchema`
 *     declares, of one only the handler itself declares, and of one only a
 *     capability the handler uses declares;
 *   - **default conflict**: two blocks declaring one session field with
 *     different defaults are refused at flow definition, and the error names
 *     the field and both blocks;
 *   - **type conflict**: the same for two blocks that give one field
 *     different types. Refusing only a default conflict fails the cell;
 *   - **capability conflict**: the same between a capability a block uses
 *     and another block, naming the capability and the block;
 *   - **identical**: two blocks declaring one field identically define
 *     without complaint.
 *
 * No refusal may carry a tracker id: it is a plain error, not a retired value.
 *
 * "At flow definition" is `defineFlow(...)` or the instance call that follows
 * it: before a server or a request.
 *
 * Prints `fresh-default: ok`, or `fresh-default: FAIL at cases: …` followed by
 * one indented line per failed case. A crash outside a case is the harness's
 * `error`.
 */
import { defineCapability, defineFlow, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { serve } from "@flow-state-dev/node";
import { z } from "zod";

const KIND = "goal-fresh-default";
const failures = [];
const empty = { inputSchema: z.object({}), outputSchema: z.object({ ok: z.boolean() }) };

/** A block that declares one session field and does nothing else. */
const declares = (name, schema) =>
  handler({ name, ...empty, sessionStateSchema: z.object(schema), execute: () => ({ ok: true }) });

/** Define a flow from two blocks; returns the error it was refused with, or null. */
function refusal(kind, a, b) {
  try {
    defineFlow({ kind, actions: { a: { inputSchema: z.object({}), block: a }, b: { inputSchema: z.object({}), block: b } } })();
    return null;
  } catch (err) {
    return String(err?.message ?? err);
  }
}

// ── reads ────────────────────────────────────────────────────────────────────
const capability = defineCapability({
  name: "goal-cap",
  sessionStateSchema: z.object({ capLabel: z.string().default("from-capability") }),
});
let seen = null;
const read = handler({
  name: "goal-reader",
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  uses: [capability],
  sessionStateSchema: z.object({ blockCount: z.number().default(7) }),
  execute: (_input, ctx) => {
    const state = ctx.session.state;
    seen = { flowMode: state.flowMode, blockCount: state.blockCount, capLabel: state.capLabel };
    return { ok: true };
  },
});
const flow = defineFlow({
  kind: KIND,
  session: { stateSchema: z.object({ flowMode: z.string().default("from-flow") }) },
  actions: { read: { inputSchema: z.object({}), block: read } },
})();
const flowState = createFlowState({ flows: [flow], stores: { default: { primary: inMemoryStores() } } });
const server = await serve(flowState, { port: 0, host: "127.0.0.1", handleSignals: false });
const base = `http://127.0.0.1:${server.port}`;
try {
  let health = 0;
  for (let i = 0; i < 50 && health !== 200; i += 1) {
    health = (await fetch(`${base}/healthz`)).status;
    if (health !== 200) await new Promise((r) => setTimeout(r, 100));
  }
  if (health !== 200) throw new Error(`healthz ${health} after 5s`);
  // A session created with no state, then its first request.
  const created = await fetch(`${base}/api/flows/${KIND}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "goal-user" }),
  });
  const sessionId = created.ok ? (await created.json()).session?.id : null;
  if (!sessionId) throw new Error(`create session: ${created.status}`);
  const res = await fetch(`${base}/api/flows/${KIND}/actions/read`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "goal-user", sessionId, input: {} }),
  });
  if (!res.ok) throw new Error(`action ${res.status}: ${(await res.text()).slice(0, 300)}`);
  for (let i = 0; i < 100 && !seen; i += 1) await new Promise((r) => setTimeout(r, 50));
  if (!seen) throw new Error("the reading handler never ran");
} finally {
  await server.close();
}
const want = { flowMode: "from-flow", blockCount: 7, capLabel: "from-capability" };
const who = { flowMode: "the flow's stateSchema", blockCount: "the handler's own sessionStateSchema", capLabel: "a capability the handler uses" };
for (const [field, value] of Object.entries(want))
  if (seen[field] !== value)
    failures.push(`reads: ${field}, declared only by ${who[field]}, reads ${JSON.stringify(seen[field])} on a fresh session, not its default ${JSON.stringify(value)}`);

// ── refusals ─────────────────────────────────────────────────────────────────
const names = (message, ...words) => words.every((w) => message.includes(w));

const byDefault = refusal(
  "goal-conflict-default",
  declares("goal-planner", { mode: z.string().default("plan") }),
  declares("goal-asker", { mode: z.string().default("ask") }),
);
if (byDefault == null) failures.push("default conflict: two blocks defaulting session.state.mode to \"plan\" and \"ask\" defined without refusal");
else if (!names(byDefault, "mode", "goal-planner", "goal-asker"))
  failures.push(`default conflict: refused without naming the field and both blocks: ${byDefault.slice(0, 200)}`);

const byType = refusal(
  "goal-conflict-type",
  declares("goal-texter", { level: z.string() }),
  declares("goal-counter", { level: z.number() }),
);
if (byType == null) failures.push("type conflict: two blocks typing session.state.level as a string and a number defined without refusal");
else if (!names(byType, "level", "goal-texter", "goal-counter"))
  failures.push(`type conflict: refused without naming the field and both blocks: ${byType.slice(0, 200)}`);

const withCapability = refusal(
  "goal-conflict-capability",
  handler({
    name: "goal-toned",
    ...empty,
    uses: [defineCapability({ name: "goal-warm-cap", sessionStateSchema: z.object({ tone: z.string().default("warm") }) })],
    execute: () => ({ ok: true }),
  }),
  declares("goal-cool", { tone: z.string().default("cool") }),
);
if (withCapability == null) failures.push("capability conflict: a capability defaulting session.state.tone to \"warm\" and a block to \"cool\" defined without refusal");
else if (!names(withCapability, "tone", "goal-warm-cap", "goal-cool"))
  failures.push(`capability conflict: refused without naming the field, the capability and the block: ${withCapability.slice(0, 200)}`);

// The refusal is a plain error, not a retired value: it carries no tracker id.
for (const [label, message] of [["default", byDefault], ["type", byType], ["capability", withCapability]])
  if (message != null && /\b[A-Z]{2,}-\d+\b/.test(message)) failures.push(`${label} conflict: the refusal carries a tracker id: ${message.slice(0, 200)}`);

const identical = refusal(
  "goal-identical",
  declares("goal-left", { shared: z.number().default(1) }),
  declares("goal-right", { shared: z.number().default(1) }),
);
if (identical != null) failures.push(`identical: two identical declarations of session.state.shared were refused: ${identical.slice(0, 200)}`);

if (failures.length === 0) console.log("fresh-default: ok");
else {
  console.log(`fresh-default: FAIL at cases: ${failures.length} case check(s) failed`);
  for (const f of failures) console.log(`  ${f}`);
}
process.exit(0);
