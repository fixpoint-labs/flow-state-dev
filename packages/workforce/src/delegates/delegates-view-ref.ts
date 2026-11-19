// FIX-2776 D1.
/**
 * The client's handle on a conversation's delegates view: the flow's address
 * and the view's name, typed by the view through a type import. Holds no
 * block, so it is safe in a browser bundle.
 */
import { viewRef } from "@flow-state-dev/client";
import { DELEGATES_VIEW } from "./delegate-keys";
import type { DelegatesView } from "./worker-delegates";

/**
 * The delegates of a conversation on worker flow `flow`, as `listDelegates`
 * answers them, kept live: `useView(delegatesViewRef(flow), {}, { sessionId })`.
 */
export const delegatesViewRef = (flow: string) => viewRef<DelegatesView>(flow, DELEGATES_VIEW);
