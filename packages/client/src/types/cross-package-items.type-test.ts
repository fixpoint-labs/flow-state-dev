import type { RequestStreamEvent } from "@flow-state-dev/core/items";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { RequestSSECallbacks } from "./index";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Assert<T extends true> = T;

const callbacks: RequestSSECallbacks = {
  onItemAdded: (event) => {
    const item: OutputItem = event.item;
    void item.provenance.blockInstanceId;
  },
  onItemDone: (event) => {
    const item: OutputItem = event.item;
    void item.provenance.phase;
  },
  onEvent: (event) => {
    if (event.type === "item.added" || event.type === "item.done") {
      void event.item.provenance.blockName;
    }
  }
};

type ItemAddedEvent = Extract<RequestStreamEvent, { type: "item.added" }>;
type EventItemAssertion = Assert<Equals<ItemAddedEvent["item"], OutputItem>>;

void callbacks;
void (false as EventItemAssertion);

export const clientCrossPackageItemTypeSmoke = true;
