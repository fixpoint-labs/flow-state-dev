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
  TProject extends JsonObject = JsonObject
> = {
  session: TSession;
  user?: TUser;
  project?: TProject;
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
 * @example
 * ```ts
 * import { contextFn } from "@flow-state-dev/core";
 * import { section, list } from "@flow-state-dev/core/prompt";
 *
 * const researchCtx = contextFn(
 *   { session: sessionStateSchema },
 *   ({ session }) => section("Research", list(session.coveredTopics))
 * );
 *
 * // Use in a generator block:
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

// Overload: session + user + project
export function contextFn<
  TSession extends ZodTypeAny,
  TUser extends ZodTypeAny,
  TProject extends ZodTypeAny
>(
  schemas: { session: TSession; user: TUser; project: TProject },
  fn: (
    scopes: {
      session: z.output<TSession>;
      user: z.output<TUser>;
      project: z.output<TProject>;
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
    if (ctx.project) {
      scopes.project = ctx.project.state;
    }

    return fn(scopes, ctx);
  };
}
