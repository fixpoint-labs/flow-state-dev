/**
 * Low-level request stream hook that maintains reactive item/status views.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createSSEClient,
  type RequestStreamHandle
} from "@flow-state-dev/client";
import type {
  BlockOutputItem,
  FunctionCallItem,
  MessageItem,
  OutputItem,
  RequestStatus,
  StatusItem
} from "@flow-state-dev/core/items";
import { useFlowContext } from "../context/FlowContext";

/**
 * Visibility filter for request stream items.
 */
export type RequestStreamFilter = {
  visibility?: OutputItem["visibility"];
};

/**
 * Options for useRequestStream.
 */
export type UseRequestStreamOptions = {
  flowKind?: string;
  requestId: string;
  baseUrl?: string;
  lastEventId?: string;
  startingAfter?: number;
  filter?: RequestStreamFilter;
};

/**
 * Return type for useRequestStream.
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
 * Low-level escape-hatch hook for subscribing to one request stream.
 */
export function useRequestStream(
  options: UseRequestStreamOptions
): UseRequestStreamResult {
  const context = useFlowContext();
  const flowKind = options.flowKind ?? context.flowKind;
  const baseUrl = options.baseUrl ?? context.baseUrl;

  if (!flowKind?.trim()) {
    throw new Error(
      "useRequestStream requires flowKind (option or FlowProvider)"
    );
  }

  if (!options.requestId.trim()) {
    throw new Error("useRequestStream requires non-empty requestId");
  }

  const [items, setItems] = useState<OutputItem[]>([]);
  const [status, setStatus] = useState<RequestStatus>("in_progress");
  const [isStreaming, setIsStreaming] = useState(true);
  const handleRef = useRef<RequestStreamHandle | null>(null);

  useEffect(() => {
    setItems([]);
    setStatus("in_progress");
    setIsStreaming(true);

    const handle = createSSEClient({
      url: `/api/flows/${encodeURIComponent(flowKind!)}/requests/${encodeURIComponent(options.requestId)}/stream`,
      baseUrl,
      lastEventId: options.lastEventId,
      startingAfter: options.startingAfter,
      onRequestStatus: (event) => {
        setStatus(event.status);

        if (
          event.status === "completed" ||
          event.status === "failed" ||
          event.status === "incomplete"
        ) {
          setIsStreaming(false);
        }
      },
      onItemAdded: (event) => {
        if (!passesVisibilityFilter(event.item, options.filter)) return;

        setItems((prev: OutputItem[]) => {
          const previousItems = prev as OutputItem[];
          const next = [...prev, event.item];
          next.sort(
            (left, right) => left.itemIndex - right.itemIndex
          );
          return next as typeof previousItems;
        });
      },
      onItemDone: (event) => {
        setItems((prev: OutputItem[]) =>
          (prev as OutputItem[]).map((item: OutputItem) =>
            item.id === event.item.id ? event.item : item
          )
        );
      },
      onError: () => {
        setIsStreaming(false);
      }
    });

    handleRef.current = handle;

    return () => {
      handle.close();
      handleRef.current = null;
    };
  }, [
    flowKind,
    options.requestId,
    baseUrl,
    options.lastEventId,
    options.startingAfter
  ]);

  const messages = useMemo(
    () =>
      items.filter(
        (item: OutputItem): item is MessageItem => item.type === "message"
      ),
    [items]
  );

  const functionCalls = useMemo(
    () =>
      items.filter(
        (item: OutputItem): item is FunctionCallItem =>
          item.type === "function_call"
      ),
    [items]
  );

  const blockOutputs = useMemo(
    () =>
      items.filter(
        (item: OutputItem): item is BlockOutputItem =>
          item.type === "fsd:block_output"
      ),
    [items]
  );

  const currentStatus = useMemo(() => {
    const statusItems = items.filter(
      (item: OutputItem): item is StatusItem => item.type === "fsd:status"
    );
    return statusItems[statusItems.length - 1];
  }, [items]);

  return {
    items,
    status,
    messages,
    functionCalls,
    blockOutputs,
    currentStatus,
    isStreaming,
    get lastEventId() {
      return handleRef.current?.lastEventId;
    },
    close: () => {
      setIsStreaming(false);
      handleRef.current?.close();
    }
  };
}

function passesVisibilityFilter(
  item: OutputItem,
  filter: RequestStreamFilter | undefined
): boolean {
  if (filter?.visibility === undefined) return true;
  return item.visibility === filter.visibility;
}
