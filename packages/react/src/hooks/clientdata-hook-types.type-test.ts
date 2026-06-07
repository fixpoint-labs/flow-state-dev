/**
 * Type test (FIX-741): the resource hooks thread their `TClient` generic onto
 * the `clientData` field of the returned handle instead of leaving it `unknown`,
 * and `ClientDataOf<typeof def>` composes with the hook generic. Compile-time
 * only — validated by `tsc` over `src/**` via the package typecheck.
 */
import type { ClientDataOf, DefinedResourceCollection } from "@flow-state-dev/core";
import { useResource } from "./useResource";
import { useResourceCollectionItem } from "./useResourceCollectionItem";
import { useResourceCollectionList } from "./useResourceCollectionList";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Assert<T extends true> = T;

type Client = { title: string; count: number };

// useResource threads TClient onto clientData (required field).
type _ResClient = Assert<
  Equals<ReturnType<typeof useResource<Client>>["clientData"], Client>
>;

// useResource defaults to `unknown` — existing untyped call sites unchanged.
type _ResDefault = Assert<
  Equals<ReturnType<typeof useResource>["clientData"], unknown>
>;

// useResourceCollectionItem threads TClient onto item.clientData (optional field).
type _ItemHandle = NonNullable<
  ReturnType<typeof useResourceCollectionItem<Client>>["item"]
>;
type _Item = Assert<Equals<_ItemHandle["clientData"], Client | undefined>>;

// useResourceCollectionList threads TClient onto items[].clientData.
type _ListItem = ReturnType<typeof useResourceCollectionList<Client>>["items"][number];
type _List = Assert<Equals<_ListItem["clientData"], Client | undefined>>;

// ClientDataOf composes: a definition's projected ClientType flows to the hook.
type _DefnClient = ClientDataOf<DefinedResourceCollection<Client, Client>>;
type _FromDefnHandle = NonNullable<
  ReturnType<typeof useResourceCollectionItem<_DefnClient>>["item"]
>;
type _FromDefn = Assert<Equals<_FromDefnHandle["clientData"], Client | undefined>>;

export const clientDataHookTypeSmoke = true;
type _Checks = [_ResClient, _ResDefault, _Item, _List, _FromDefn];
void 0 as unknown as _Checks;
