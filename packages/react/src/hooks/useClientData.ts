/**
 * Client data subscription hook that reads scope-grouped clientData values from session snapshots.
 */
import { useMemo } from "react";
import type { SessionView } from "./useSession";

/**
 * Structural schema contract accepted for typed clientData inference.
 */
export type ZodSchemaLike = {
  _output?: unknown;
  parse?: (input: unknown) => unknown;
};

/**
 * Client data subscription options for one scope.
 */
export type ClientDataScopeSubscribeOptions =
  | string[]
  | Record<string, ZodSchemaLike | true>;

/**
 * Client data subscription options grouped by scope.
 */
export type ClientDataSubscribeOptions = {
  session?: ClientDataScopeSubscribeOptions;
  user?: ClientDataScopeSubscribeOptions;
  project?: ClientDataScopeSubscribeOptions;
};

type InferSchemaOutput<TSchema> = TSchema extends { _output: infer TOutput }
  ? TOutput
  : unknown;

type InferClientDataMap<TOptions> = TOptions extends readonly (infer TKey)[]
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
 * Inferred client data value shape returned by useClientData.
 */
export type ClientDataValues<TOptions extends ClientDataSubscribeOptions> =
  (TOptions extends { session: infer TSession }
    ? { session: InferClientDataMap<TSession> }
    : {}) &
  (TOptions extends { user: infer TUser }
    ? { user: InferClientDataMap<TUser> }
    : {}) &
  (TOptions extends { project: infer TProject }
    ? { project: InferClientDataMap<TProject> }
    : {});

function selectScopeClientData(
  allValues: Record<string, unknown> | undefined,
  options: ClientDataScopeSubscribeOptions
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
 * Reads scope-grouped clientData values from the current session snapshot.
 */
export function useClientData<TOptions extends ClientDataSubscribeOptions>(
  session: SessionView,
  options: TOptions
): ClientDataValues<TOptions> {
  return useMemo(() => {
    const dataSource = session.snapshot?.clientData ?? {};
    const next: Record<string, unknown> = {};

    if (options.session !== undefined) {
      next.session = selectScopeClientData(
        dataSource.session,
        options.session
      );
    }

    if (options.user !== undefined) {
      next.user = selectScopeClientData(dataSource.user, options.user);
    }

    if (options.project !== undefined) {
      next.project = selectScopeClientData(
        dataSource.project,
        options.project
      );
    }

    return next as ClientDataValues<TOptions>;
  }, [session.snapshot, options]);
}
