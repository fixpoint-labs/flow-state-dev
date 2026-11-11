/**
 * Type test (FIX-741): the resource hooks thread their `TClient` generic onto
 * the `clientData` field of the returned handle instead of leaving it `unknown`,
 * and `ClientDataOf<typeof def>` composes with the hook generic. Compile-time
 * only — validated by `tsc` via the package typecheck.
 */
import type { ClientDataOf, DefinedResourceCollection } from "@flow-state-dev/core";
import { useResource } from "../src/hooks/useResource";
import { useCollectionResource } from "../src/hooks/useCollectionResource";
import { useResourceCollectionList } from "../src/hooks/useResourceCollectionList";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Assert<T extends true> = T;

type Client = { title: string; count: number };

// useResource takes the definition and threads its branded client type onto `value`
// (FIX-2624, D2), `| null` until read; a collection's value is its entries.
type _ResValue = Assert<
  Equals<ReturnType<typeof useResource<{ scope: "user"; ref: "doc"; ClientType: Client }>>["value"], Client | null>
>;
type _ResEntries = Assert<
  Equals<
    NonNullable<ReturnType<typeof useResource<{ scope: "org"; pattern: "docs/*"; ClientType: Client }>>["value"]>[number]["value"],
    Client
  >
>;

// useCollectionResource threads TClient onto item.clientData (optional field).
type _ItemHandle = NonNullable<
  ReturnType<typeof useCollectionResource<Client>>["item"]
>;
type _Item = Assert<Equals<_ItemHandle["clientData"], Client | undefined>>;

// useResourceCollectionList threads TClient onto items[].clientData.
type _ListItem = ReturnType<typeof useResourceCollectionList<Client>>["items"][number];
type _List = Assert<Equals<_ListItem["clientData"], Client | undefined>>;

// ClientDataOf composes: a definition's projected ClientType flows to the hook.
type _DefnClient = ClientDataOf<DefinedResourceCollection<Client, Client>>;
type _FromDefnHandle = NonNullable<
  ReturnType<typeof useCollectionResource<_DefnClient>>["item"]
>;
type _FromDefn = Assert<Equals<_FromDefnHandle["clientData"], Client | undefined>>;

export const clientDataHookTypeSmoke = true;
type _Checks = [_ResValue, _ResEntries, _Item, _List, _FromDefn];
void 0 as unknown as _Checks;
