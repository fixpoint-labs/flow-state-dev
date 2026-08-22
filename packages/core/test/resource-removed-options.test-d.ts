/**
 * Compile-time assertion that `defineResource()` rejects the removed `dynamic`
 * option.
 *
 * `defineResource` takes its config as a naked generic parameter
 * (`config: TConfig`, constrained by `ResourceConfig & { stateSchema }`), so
 * TypeScript's excess-property check never fires on the call-site literal.
 * Deleting `dynamic` from `ResourceConfig` alone therefore left it silently
 * accepted — and spread onto the returned definition. The `dynamic?: never`
 * guard on `ResourceConfig` closes that: a literal carrying `dynamic` no
 * longer satisfies the constraint.
 *
 * Every other option removed alongside `dynamic` sits behind a concrete
 * parameter type (`defineFlow`, `generator`, `createFlowApiRouter`,
 * `createRunSkillTool`, `parallelTasks`, `supervisor`), where excess-property
 * checking already rejects it. No sibling guard is needed.
 *
 * `tsconfig.test-d.json` compiles every `.test-d.ts` file in this package's
 * `test` directory, and the `typecheck` script runs it after the `src` pass.
 * Drop the guard and the `@ts-expect-error` below has nothing to suppress,
 * which is itself an error (TS2578) — so `pnpm typecheck` goes red.
 */
import { z } from "zod";
import { defineResource } from "@flow-state-dev/core";

/** Control: the same config without `dynamic` still compiles. */
export const accepted = defineResource({
  name: "type-test-resource",
  scope: "session",
  stateSchema: z.object({ value: z.string() }).default({ value: "" }),
});

export const rejected = defineResource({
  name: "type-test-resource-dynamic",
  scope: "session",
  stateSchema: z.object({ value: z.string() }).default({ value: "" }),
  // @ts-expect-error `dynamic` was removed — the `never` guard rejects it.
  dynamic: true,
});
