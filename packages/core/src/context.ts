import type { ZodTypeAny, z } from "zod";
import type { BlockContext } from "./types/block";
import type { JsonObject } from "./schema/common";

/**
 * Scope access object passed to a contextFn callback.
 * Each property is present only if declared in the schemas parameter.
 */
export type ContextFnScopes<
  TSession extends JsonObject = JsonObject,
  TUser extends JsonObject = JsonObject,
  TOrg extends JsonObject = JsonObject
> = {
  session: TSession;
  user?: TUser;
  org?: TOrg;
};

/**
 * The function signature returned by contextFn. Compatible with generator
 * `context` slots — receives the block input and ctx, returns a string.
 */
export type ContextFunction = (input: unknown, ctx: BlockContext) => string;

/**
 * Creates a typed context function for use in generator `context` slots.
 *
 * The `schemas` parameter acts as a type carrier — it declares which scope
 * state types the callback expects, enabling TypeScript inference without
 * any runtime schema validation. The actual state values are read from
 * `BlockContext` scope handles at execution time.
 *
 * The returned function fits anywhere a `GeneratorSlotEntry` does. Two
 * common shapes:
 *
 * - **Array form:** `context: [researchCtx]` — the function's string return
 *   becomes a system message of its own.
 * - **Object form:** `context: { research: researchCtx }` — the function's
 *   return is wrapped in `<research>...</research>` and aggregates with any
 *   other contributions to the `research` key from capabilities or other
 *   slots. See `ContextObject` for the full object-form contract.
 *
 * @example
 * ```ts
 * import { contextFn } from "@flow-state-dev/core";
 * import { list } from "@flow-state-dev/core/prompt";
 *
 * const researchCtx = contextFn(
 *   { session: sessionStateSchema },
 *   ({ session }) => list(session.coveredTopics)
 * );
 *
 * // Object form — wrapped under <research> and aggregated cross-source.
 * generator({
 *   name: "researcher",
 *   context: { research: researchCtx },
 *   // ...
 * });
 * ```
 */

// Overload: session-only
export function contextFn<TSession extends ZodTypeAny>(
  schemas: { session: TSession },
  fn: (
    scopes: { session: z.output<TSession> },
    ctx: BlockContext
  ) => string
): ContextFunction;

// Overload: session + user
export function contextFn<TSession extends ZodTypeAny, TUser extends ZodTypeAny>(
  schemas: { session: TSession; user: TUser },
  fn: (
    scopes: { session: z.output<TSession>; user: z.output<TUser> },
    ctx: BlockContext
  ) => string
): ContextFunction;

// Overload: session + user + org
export function contextFn<
  TSession extends ZodTypeAny,
  TUser extends ZodTypeAny,
  TOrg extends ZodTypeAny
>(
  schemas: { session: TSession; user: TUser; org: TOrg },
  fn: (
    scopes: {
      session: z.output<TSession>;
      user: z.output<TUser>;
      org: z.output<TOrg>;
    },
    ctx: BlockContext
  ) => string
): ContextFunction;

// Implementation — uses `any` for overload compatibility (standard TS overload pattern)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function contextFn(
  _schemas: any,
  fn: any
): ContextFunction {
  return (_input: unknown, ctx: BlockContext): string => {
    const scopes: Record<string, unknown> = {};

    if (ctx.session) {
      scopes.session = ctx.session.state;
    }
    if (ctx.user) {
      scopes.user = ctx.user.state;
    }
    if (ctx.org) {
      scopes.org = ctx.org.state;
    }

    return fn(scopes, ctx);
  };
}
