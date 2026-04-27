/**
 * Client data subscription hook that reads scope-grouped clientData values from session snapshots.
 */
import { useMemo, useRef } from "react";
import type { SessionView } from "./useSession";
import { shallowEqualRecord } from "../internal/shallowEqualRecord";

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
  org?: ClientDataScopeSubscribeOptions;
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
  (TOptions extends { org: infer TOrg }
    ? { org: InferClientDataMap<TOrg> }
    : {});

function toDataNames(options: ClientDataScopeSubscribeOptions | undefined): string[] {
  if (options === undefined) {
    return [];
  }

  if (Array.isArray(options)) {
    return options;
  }

  return Object.keys(options);
}

function selectScopeClientData(
  allValues: Record<string, unknown> | undefined,
  names: string[]
): Record<string, unknown> {
  const source = allValues ?? {};
  return Object.fromEntries(names.map((name) => [name, source[name]]));
}

/**
 * Reads scope-grouped clientData values from the current session snapshot.
 */
export function useClientData<TOptions extends ClientDataSubscribeOptions>(
  session: SessionView,
  options: TOptions
): ClientDataValues<TOptions> {
  const sessionNames = toDataNames(options.session);
  const userNames = toDataNames(options.user);
  const orgNames = toDataNames(options.org);

  const sessionNamesKey = sessionNames.join("\u001f");
  const userNamesKey = userNames.join("\u001f");
  const orgNamesKey = orgNames.join("\u001f");

  const previousResultRef = useRef<ClientDataValues<TOptions> | null>(null);

  return useMemo(() => {
    const dataSource = session.snapshot?.clientData ?? {};
    const next: Record<string, unknown> = {};

    if (options.session !== undefined) {
      next.session = selectScopeClientData(
        dataSource.session,
        sessionNames
      );
    }

    if (options.user !== undefined) {
      next.user = selectScopeClientData(dataSource.user, userNames);
    }

    if (options.org !== undefined) {
      next.org = selectScopeClientData(dataSource.org, orgNames);
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
      const sameOrg = shallowEqualRecord(
        previous.org as Record<string, unknown> | undefined,
        next.org as Record<string, unknown> | undefined
      );

      if (sameSession && sameUser && sameOrg) {
        return previousResultRef.current as ClientDataValues<TOptions>;
      }
    }

    const typed = next as ClientDataValues<TOptions>;
    previousResultRef.current = typed;
    return typed;
  }, [
    session.snapshot?.clientData,
    options.session,
    options.user,
    options.org,
    sessionNamesKey,
    userNamesKey,
    orgNamesKey
  ]);
}
