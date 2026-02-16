/**
 * Request stream hook wrapper that maintains stream-derived item/status views.
 */
import {
  createSSEClient,
  type RequestStreamHandle,
  type SessionStateSnapshotResponse
} from "@flow-state-dev/client";
import type {
  BlockOutputItem,
  FunctionCallItem,
  MessageItem,
  OutputItem,
  RequestStatus,
  StatusItem
} from "@flow-state-dev/core/items";
import { getFlowContext } from "../context/FlowContext";

/**
 * Visibility filter options for request stream item views.
 */
export type RequestStreamFilter = {
  visibility?: OutputItem["visibility"];
};

/**
 * Options for creating request stream wrappers.
 */
export type UseRequestStreamOptions = {
  flowKind?: string;
  requestId: string;
  baseUrl?: string;
  lastEventId?: string;
  startingAfter?: number;
  filter?: RequestStreamFilter;
  onCompletedRefetch?: () => Promise<SessionStateSnapshotResponse | void>;
};

/**
 * API surface returned from request stream wrappers.
 */
export type UseRequestStreamResult = {
  readonly items: OutputItem[];
  readonly status: RequestStatus;
  readonly messages: MessageItem[];
  readonly functionCalls: FunctionCallItem[];
  readonly blockOutputs: BlockOutputItem[];
  readonly currentStatus?: StatusItem;
  readonly isStreaming: boolean;
  readonly lastEventId?: string;
  close: () => void;
};

/**
 * Creates a request stream wrapper that tracks stream state in local memory.
 */
export function useRequestStream(
  options: UseRequestStreamOptions
): UseRequestStreamResult {
  const context = getFlowContext();
  const flowKind = options.flowKind ?? context.flowKind;
  if (flowKind === undefined || flowKind.trim().length === 0) {
    throw new Error("useRequestStream requires flowKind (option or FlowContext)");
  }

  const requestId = options.requestId.trim();
  if (requestId.length === 0) {
    throw new Error("useRequestStream requires non-empty requestId");
  }

  let items: OutputItem[] = [];
  let status: RequestStatus = "in_progress";
  let isStreaming = true;
  let handle: RequestStreamHandle | undefined;

  handle = createSSEClient({
    url: `/api/flows/${encodeURIComponent(flowKind)}/requests/${encodeURIComponent(requestId)}/stream`,
    baseUrl: options.baseUrl ?? context.baseUrl,
    lastEventId: options.lastEventId,
    startingAfter: options.startingAfter,
    onRequestStatus: (event) => {
      status = event.status;
      if (status === "completed") {
        void options.onCompletedRefetch?.();
      }

      if (status === "completed" || status === "failed" || status === "incomplete") {
        isStreaming = false;
      }
    },
    onItemAdded: (event) => {
      const item = event.item;
      if (!passesVisibilityFilter(item, options.filter)) {
        return;
      }

      items = [...items, item].sort((left, right) => left.itemIndex - right.itemIndex);
    },
    onItemDone: (event) => {
      const doneItem = event.item;
      items = items.map((item) =>
        item.id === doneItem.id
          ? doneItem
          : item
      );
    },
    onError: () => {
      isStreaming = false;
    }
  });

  return {
    get items() {
      return items;
    },
    get status() {
      return status;
    },
    get messages() {
      return items.filter((item): item is MessageItem => item.type === "message");
    },
    get functionCalls() {
      return items.filter(
        (item): item is FunctionCallItem => item.type === "function_call"
      );
    },
    get blockOutputs() {
      return items.filter(
        (item): item is BlockOutputItem => item.type === "fsd:block_output"
      );
    },
    get currentStatus() {
      const statusItems = items.filter(
        (item): item is StatusItem => item.type === "fsd:status"
      );
      return statusItems[statusItems.length - 1];
    },
    get isStreaming() {
      return isStreaming;
    },
    get lastEventId() {
      return handle?.lastEventId;
    },
    close: () => {
      isStreaming = false;
      handle?.close();
    }
  };
}

function passesVisibilityFilter(
  item: OutputItem,
  filter: RequestStreamFilter | undefined
): boolean {
  if (filter?.visibility === undefined) {
    return true;
  }

  return item.visibility === filter.visibility;
}
