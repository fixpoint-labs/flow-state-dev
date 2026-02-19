/**
 * Projection subscription hook that reads scope-grouped projection values from session snapshots.
 */
import { useMemo } from "react";
import type { SessionView } from "./useSession";

/**
 * Structural schema contract accepted for typed projection inference.
 */
export type ZodSchemaLike = {
  _output?: unknown;
  parse?: (input: unknown) => unknown;
};

/**
 * Projection subscription options for one scope.
 */
export type ProjectionScopeSubscribeOptions =
  | string[]
  | Record<string, ZodSchemaLike | true>;

/**
 * Projection subscription options grouped by scope.
 */
export type ProjectionSubscribeOptions = {
  session?: ProjectionScopeSubscribeOptions;
  user?: ProjectionScopeSubscribeOptions;
  project?: ProjectionScopeSubscribeOptions;
};

type InferSchemaOutput<TSchema> = TSchema extends { _output: infer TOutput }
  ? TOutput
  : unknown;

type InferProjectionMap<TOptions> = TOptions extends readonly (infer TKey)[]
  ? TKey extends string
    ? Record<TKey, unknown>
    : Record<string, unknown>
  : TOptions extends (infer TKey)[]
    ? TKey extends string
      ? Record<TKey, unknown>
      : Record<string, unknown>
    : TOptions extends Record<string, unknown>
      ? {
          [TKey in keyof TOptions]: TOptions[TKey] extends ZodSchemaLike
            ? InferSchemaOutput<TOptions[TKey]>
            : unknown;
        }
      : Record<string, unknown>;

/**
 * Inferred projection value shape returned by useProjections.
 */
export type ProjectionValues<TOptions extends ProjectionSubscribeOptions> =
  (TOptions extends { session: infer TSession }
    ? { session: InferProjectionMap<TSession> }
    : {}) &
  (TOptions extends { user: infer TUser }
    ? { user: InferProjectionMap<TUser> }
    : {}) &
  (TOptions extends { project: infer TProject }
    ? { project: InferProjectionMap<TProject> }
    : {});

function selectScopeProjections(
  allValues: Record<string, unknown> | undefined,
  options: ProjectionScopeSubscribeOptions
): Record<string, unknown> {
  const source = allValues ?? {};

  if (Array.isArray(options)) {
    return Object.fromEntries(options.map((name) => [name, source[name]]));
  }

  return Object.fromEntries(
    Object.keys(options).map((name) => [name, source[name]])
  );
}

/**
 * Reads scope-grouped projection values from the current session snapshot.
 */
export function useProjections<TOptions extends ProjectionSubscribeOptions>(
  session: SessionView,
  options: TOptions
): ProjectionValues<TOptions> {
  return useMemo(() => {
    const projectionSource = session.snapshot?.projections ?? {};
    const next: Record<string, unknown> = {};

    if (options.session !== undefined) {
      next.session = selectScopeProjections(
        projectionSource.session,
        options.session
      );
    }

    if (options.user !== undefined) {
      next.user = selectScopeProjections(projectionSource.user, options.user);
    }

    if (options.project !== undefined) {
      next.project = selectScopeProjections(
        projectionSource.project,
        options.project
      );
    }

    return next as ProjectionValues<TOptions>;
  }, [session.snapshot, options]);
}
