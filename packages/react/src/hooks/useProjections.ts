/**
 * Projection subscription hook that reads scope-grouped projection values from session snapshots.
 */
import { useMemo, useRef } from "react";
import type { SessionView } from "./useSession";
import { shallowEqualRecord } from "../internal/shallowEqualRecord";

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

function toProjectionNames(options: ProjectionScopeSubscribeOptions | undefined): string[] {
  if (options === undefined) {
    return [];
  }

  if (Array.isArray(options)) {
    return options;
  }

  return Object.keys(options);
}

function selectScopeProjections(
  allValues: Record<string, unknown> | undefined,
  names: string[]
): Record<string, unknown> {
  const source = allValues ?? {};
  return Object.fromEntries(names.map((name) => [name, source[name]]));
}

export function useProjections<TOptions extends ProjectionSubscribeOptions>(
  session: SessionView,
  options: TOptions
): ProjectionValues<TOptions> {
  const sessionNames = toProjectionNames(options.session);
  const userNames = toProjectionNames(options.user);
  const projectNames = toProjectionNames(options.project);

  const sessionNamesKey = sessionNames.join("\u001f");
  const userNamesKey = userNames.join("\u001f");
  const projectNamesKey = projectNames.join("\u001f");

  const previousResultRef = useRef<ProjectionValues<TOptions> | null>(null);

  return useMemo(() => {
    const projectionSource = session.snapshot?.projections ?? {};
    const next: Record<string, unknown> = {};

    if (options.session !== undefined) {
      next.session = selectScopeProjections(
        projectionSource.session,
        sessionNames
      );
    }

    if (options.user !== undefined) {
      next.user = selectScopeProjections(projectionSource.user, userNames);
    }

    if (options.project !== undefined) {
      next.project = selectScopeProjections(projectionSource.project, projectNames);
    }

    const previous = previousResultRef.current as Record<string, unknown> | null;
    if (previous !== null) {
      const sameSession = shallowEqualRecord(
        previous.session as Record<string, unknown> | undefined,
        next.session as Record<string, unknown> | undefined
      );
      const sameUser = shallowEqualRecord(
        previous.user as Record<string, unknown> | undefined,
        next.user as Record<string, unknown> | undefined
      );
      const sameProject = shallowEqualRecord(
        previous.project as Record<string, unknown> | undefined,
        next.project as Record<string, unknown> | undefined
      );

      if (sameSession && sameUser && sameProject) {
        return previousResultRef.current as ProjectionValues<TOptions>;
      }
    }

    const typed = next as ProjectionValues<TOptions>;
    previousResultRef.current = typed;
    return typed;
  }, [
    session.snapshot?.projections,
    options.session,
    options.user,
    options.project,
    sessionNamesKey,
    userNamesKey,
    projectNamesKey
  ]);
}
