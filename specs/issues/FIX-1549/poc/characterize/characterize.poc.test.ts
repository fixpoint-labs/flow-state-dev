/**
 * FIX-1549 characterization — what the roster fence costs an app that never
 * installs @flow-state-dev/workforce, on today's code.
 *
 * Retained spec evidence, not production code: copied into packages/engine/test
 * by run.sh for one run and removed. Nothing here imports @flow-state-dev/workforce
 * and no flow declares the branded private roster writer, so every refusal
 * below is Workforce policy paid by a non-Workforce app.
 *
 * Totality: CORPUS is the whole pattern set this spec argues from. Every row
 * carries both verdicts (define, register), and the test fails if any row's
 * observed verdict differs from the table, so an unlisted behaviour change on
 * either path turns it red.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { createFlowRegistry } from "../src";

/** "refused" = refused by the roster fence (message names the roster); "other" = refused for any other reason. */
type Verdict = "ok" | "refused" | "other";

function classify(error: unknown): Verdict {
  return /roster/i.test(String((error as Error)?.message)) ? "refused" : "other";
}

/** pattern → [defineResourceCollection verdict, FlowRegistry.register verdict] */
const CORPUS: Array<[string, Verdict, Verdict]> = [
  // Workforce's own namespace, declared by an app that has never heard of it.
  ["workforce/roster/[owner]/notes", "refused", "refused"],
  ["workforce/roster/**", "refused", "refused"],
  ["workforce/**", "refused", "refused"],
  ["workforce/roster/[owner]/[seat]", "ok", "refused"],
  // Generic shapes with no Workforce name in them at all.
  ["**", "refused", "refused"],
  ["[tenant]/**", "ok", "refused"],
  ["[a]/[b]/[c]/[d]", "ok", "refused"],
  ["*/**", "ok", "refused"],
  // Controls: shapes the fence never touches.
  ["workforce/roster/*", "ok", "ok"],
  ["files/**", "ok", "ok"],
  ["[tenant]/notes/[id]", "ok", "ok"],
  ["[a]/[b]/[c]", "ok", "ok"],
];

function defineVerdict(pattern: string): Verdict {
  try {
    defineResourceCollection({ pattern, scope: "org", stateSchema: z.object({}).passthrough() });
    return "ok";
  } catch (error) {
    return classify(error);
  }
}

let n = 0;
function registerVerdict(pattern: string): Verdict {
  n += 1;
  const flow = defineFlow({
    kind: `app-${n}`,
    actions: {
      ping: {
        inputSchema: z.object({}),
        block: handler({
          name: `ping-${n}`,
          inputSchema: z.object({}),
          outputSchema: z.object({ ok: z.boolean() }),
          execute: () => ({ ok: true }),
        }),
      },
    },
  })();
  // Bypass definition so the registration path is measured on its own.
  (flow as { resources: unknown }).resources = {
    notes: { pattern, scope: "org" },
  };
  try {
    createFlowRegistry().register(flow);
    return "ok";
  } catch (error) {
    return classify(error);
  }
}

describe("FIX-1549 · the roster fence in an app without Workforce, today", () => {
  const observed = CORPUS.map(([pattern]) => [pattern, defineVerdict(pattern), registerVerdict(pattern)]);

  it("prints the table", () => {
    console.table(observed.map(([p, d, r]) => ({ pattern: p, define: d, register: r })));
  });

  it.each(CORPUS)("%s → define %s, register %s", (pattern, define, register) => {
    expect(defineVerdict(pattern)).toBe(define);
    expect(registerVerdict(pattern)).toBe(register);
  });

  it("negative control: a verdict flipped in the table is caught", () => {
    // Plant a wrong expectation and prove the comparison can go red.
    const [pattern] = CORPUS[0]!;
    expect(() => expect(defineVerdict(pattern)).toBe("ok")).toThrow();
  });
});
