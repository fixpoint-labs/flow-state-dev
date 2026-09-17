/**
 * Characterization check — FIX-1355, DECISIONS → Settled.
 *
 * Premise under test: **a channel fan-out cannot wake the built-in `agent`
 * kind.** D3 rests on it. If it is false, the lab does not need a kind of its
 * own and the whole shape gets smaller.
 *
 * Run:  node_modules/.bin/tsx spec-poc/FIX-1355-runtime-premises/check-agent-kind-has-no-internal-entry.mts
 *
 * What makes it go red: the built-in kind gaining an `internal.actions` entry.
 * Assertion 1 then fails and D3's first half is stale. Assertion 2 is the
 * reach control — it fails if the probe stopped reaching a real flow at all,
 * so a green assertion 1 can never be "the import quietly broke".
 */

import { resolveEntry } from "../../packages/core/src/flow/resolve-entry";
import { AGENT_KIND, defineAgentWorkerFlow } from "../../packages/workforce/src/agent-worker-flow";

const instance = defineAgentWorkerFlow()({ id: "probe-seat" }) as any;

let failures = 0;
const check = (label: string, ok: boolean, saw: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n        saw: ${saw}`);
  if (!ok) failures += 1;
};

console.log(`built-in kind: "${instance.kind}" (expected "${AGENT_KIND}")`);
console.log(`declared public actions: ${Object.keys(instance.actions ?? {}).join(", ") || "<none>"}`);
console.log(`declared internal map:   ${JSON.stringify(instance.internal ?? null)}\n`);

// 1 — the claim. A fan-out dispatches `internal`; this kind declares no such
// map, and `resolveEntry` never falls through from `internal` to `public`.
const internalRun = resolveEntry(instance, "internal", "run");
check(
  "an `internal` dispatch to the built-in agent kind resolves NO entry",
  internalRun === undefined,
  `resolveEntry(agent, "internal", "run") = ${internalRun === undefined ? "undefined" : "an entry"}`,
);

// The map ITSELF, not a list of guessed names. An earlier draft probed five
// spellings, which would have stayed green if the kind gained an internal entry
// called `wake` — the premise false and every assertion passing. Review caught
// it. This asserts the declaration, so ANY entry added under ANY name goes red.
const internalNames = Object.keys(instance.internal?.actions ?? {});
check(
  "the kind declares NO internal actions at all — asserted on the map, not on guesses",
  instance.internal === undefined || internalNames.length === 0,
  internalNames.length === 0
    ? `internal.actions = ${JSON.stringify(instance.internal?.actions ?? null)} (no entries under any name)`
    : `internal.actions declares: ${internalNames.join(", ")} — a fan-out CAN reach this kind`,
);

// 2 — the reach control. The flow really does declare `run` publicly, so
// assertion 1's `undefined` is the internal map being absent and not the probe
// failing to reach a flow.
const publicRun = resolveEntry(instance, "public", "run");
check(
  "CONTROL · the same probe DOES resolve the kind's public `run`",
  publicRun !== undefined,
  `resolveEntry(agent, "public", "run") = ${publicRun === undefined ? "undefined" : "an entry"}`,
);

// 3 — the red-state control. BP-003: a check nobody can make fail has verified
// nothing. Same probe, same call, against a flow that DOES declare an internal
// entry — it must resolve. So the `undefined` above is the agent kind's absent
// map, and this check would turn red the day that map appears.
const withInternalEntry = {
  actions: { run: { block: "public" } },
  internal: { actions: { brief: { block: "internal" } } },
};
const sees = resolveEntry(withInternalEntry as any, "internal", "brief");
check(
  "CONTROL · the same probe DOES resolve an internal entry where one exists",
  sees !== undefined,
  `resolveEntry(<flow with internal.actions.brief>, "internal", "brief") = ${
    sees === undefined ? "undefined — THE PROBE IS BLIND" : "an entry"
  }`,
);

// And it must not fall through from `internal` to `public` — the exact
// behaviour D3's "refuses `no-entry`" rests on.
const fellThrough = resolveEntry(withInternalEntry as any, "internal", "run");
check(
  "CONTROL · `internal` never falls through to a public action of the same name",
  fellThrough === undefined,
  `resolveEntry(<flow declaring public "run" only>, "internal", "run") = ${
    fellThrough === undefined ? "undefined" : "an entry — fall-through EXISTS"
  }`,
);

console.log(`\n${failures === 0 ? "CONFIRMED" : "REFUTED"} — ${failures} failing assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
