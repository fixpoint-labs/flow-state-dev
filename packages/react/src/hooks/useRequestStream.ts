/**
 * Low-level request stream hook that maintains reactive item/status views.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createSSEClient,
  type RequestStreamHandle
} from "@flow-state-dev/client";
import type {
  BlockTraceItem,
  MessageItem,
  OutputItem,
  RequestStatus,
  StatusItem
} from "@flow-state-dev/core/items";

// Identity-invariant keys stripped before applying an `item.updated` patch.
// Mirrors `ITEM_UPDATE_INVARIANT_KEYS` from `@flow-state-dev/core/items` —
// inlined because this package may only import types from core.
const ITEM_UPDATE_INVARIANT_KEYS: ReadonlyArray<string> = [
  "id",
  "type",
  "provenance",
  "itemVisibility",
  "transient"
];
import { useFlowContext } from "../context/FlowContext";
import { insertSortedIntoArray } from "../internal/item-store";

/**
 * Type-based filter for request stream items.
 */
export type RequestStreamFilter = {
  itemTypes?: string[];
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
  readonly blockOutputs: BlockTraceItem[];
  readonly currentStatus?: StatusItem;
  readonly isStreaming: boolean;
  /** True when the main execution chain has completed but background work tasks are still running. */
  readonly isFinishing: boolean;
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
  const [isFinishing, setIsFinishing] = useState(false);
  const handleRef = useRef<RequestStreamHandle | null>(null);

  useEffect(() => {
    setItems([]);
    setStatus("in_progress");
    setIsStreaming(true);
    setIsFinishing(false);

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
          event.status === "incomplete" ||
          event.status === "interrupted" ||
          event.status === "aborted" ||
          event.status === "suspended"
        ) {
          setIsStreaming(false);
          setIsFinishing(false);
        }
      },
      onItemAdded: (event) => {
        if (!passesTypeFilter(event.item, options.filter)) return;

        if (event.item.type === "status" && (event.item as StatusItem).blocked === false) {
          setIsFinishing(true);
        }

        setItems((prev: OutputItem[]) => insertSortedIntoArray(prev, event.item));
      },
      onItemDone: (event) => {
        setItems((prev: OutputItem[]) =>
          prev.map((item: OutputItem) =>
            item.id === event.item.id ? event.item : item
          )
        );
      },
      onItemUpdated: (event) => {
        setItems((prev: OutputItem[]) => {
          let changed = false;
          const next = prev.map((item: OutputItem) => {
            if (item.id !== event.itemId) return item;
            const sanitized: Record<string, unknown> = {};
            for (const key of Object.keys(event.patch)) {
              if (ITEM_UPDATE_INVARIANT_KEYS.includes(key)) continue;
              sanitized[key] = event.patch[key];
            }
            changed = true;
            return { ...item, ...sanitized } as OutputItem;
          });
          return changed ? next : prev;
        });
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

  const blockOutputs = useMemo(
    () =>
      // `block_output` arrives via the trace channel; not in the public
      // OutputItem union. Cast at the boundary.
      (items as Array<OutputItem | BlockTraceItem>).filter(
        (item): item is BlockTraceItem =>
          (item as { type: string }).type === "block_trace"
      ),
    [items]
  );

  const currentStatus = useMemo(() => {
    const statusItems = items.filter(
      (item: OutputItem): item is StatusItem => item.type === "status"
    );
    return statusItems[statusItems.length - 1];
  }, [items]);

  return {
    items,
    status,
    messages,
    blockOutputs,
    currentStatus,
    isStreaming,
    isFinishing,
    get lastEventId() {
      return handleRef.current?.lastEventId;
    },
    close: () => {
      setIsStreaming(false);
      handleRef.current?.close();
    }
  };
}

function passesTypeFilter(
  item: OutputItem,
  filter: RequestStreamFilter | undefined
): boolean {
  if (filter?.itemTypes === undefined) return true;
  return filter.itemTypes.includes(item.type);
}
