// FIX-2623.
/**
 * Compiled under `strict` (`tsconfig.test-d-strict.json`), as an app's own
 * code usually is: this package's other checks run non-strict, where a
 * function's parameters are bivariant and the gap below can't show.
 *
 * A view whose answer is one object, not a list, has no row key. It must still
 * be a flow's `views` entry and a client's `viewRef` type with no cast. A
 * function-typed `key` over `never` (no list, no element) is not assignable to
 * the general view's `key` over `unknown` under `strictFunctionTypes`, so every
 * such view would need a cast where it is installed.
 */
import { expectTypeOf } from "vitest";
import { z } from "zod";
import { defineFlow, defineView, handler } from "@flow-state-dev/core";
import type { ViewOutput } from "@flow-state-dev/core/types";

const summary = handler({
  name: "summary",
  inputSchema: z.object({}),
  outputSchema: z.object({ total: z.number() }),
  sessionStateSchema: z.object({ total: z.number().default(0) }),
  execute: (_input, ctx) => ({ total: ctx.session.state.total })
});
const summaryView = defineView({ scope: "session", block: summary });

expectTypeOf<ViewOutput<typeof summaryView>>().toEqualTypeOf<{ total: number }>();
defineFlow({ kind: "desk", actions: {}, views: { summary: summaryView } });

// A list view keeps its key typed by the entry.
const entries = handler({
  name: "entries",
  inputSchema: z.object({}),
  outputSchema: z.array(z.object({ id: z.string() })),
  execute: () => [{ id: "a" }]
});
defineFlow({ kind: "desk", actions: {}, views: { entries: defineView({ scope: "user", block: entries, key: (entry) => entry.id }) } });
// @ts-expect-error a list entry has no `name`.
defineView({ scope: "user", block: entries, key: (entry) => entry.name });
