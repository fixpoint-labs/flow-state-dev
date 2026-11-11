// FIX-2623.
/**
 * The roster view's entry and the client's `RosterEntry` are one shape. The view
 * declares its entries as a zod schema (what the engine validates and the client
 * types its answer by); `RosterEntry` is the documented type apps import. A
 * field added to, dropped from or retyped on either side, and not the other,
 * fails this file's compile, so the wire shape can't drift from the client type.
 *
 * Assignable both ways, plus the same keys, rather than strict equality:
 * `RosterEntry.settings` is `Readonly<...>` for callers, which zod's inferred
 * entry doesn't spell, and that difference is not drift.
 *
 * Compiled by `tsconfig.test-d.json` in the package's `typecheck` script;
 * vitest only strips types.
 */
import { expectTypeOf } from "vitest";
import type { ViewValueOf } from "@flow-state-dev/client";
import { rosterView, type RosterEntry } from "../src/browser";

type RosterViewEntry = ViewValueOf<typeof rosterView>[number];

expectTypeOf<RosterViewEntry>().toExtend<RosterEntry>();
expectTypeOf<RosterEntry>().toExtend<RosterViewEntry>();
expectTypeOf<keyof RosterViewEntry>().toEqualTypeOf<keyof RosterEntry>();
