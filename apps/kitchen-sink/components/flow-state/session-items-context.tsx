"use client";

/**
 * Re-export of the session item list context from `@flow-state-dev/react`.
 *
 * `ItemsRenderer` mounts the provider with the list it renders. Import
 * `useSessionItems` / `SessionItemsProvider` from here in copied registry
 * components so they share that context. Mount the provider yourself only
 * when rendering stream-aware cards outside `ItemsRenderer`.
 */
export {
  SessionItemsProvider,
  useSessionItems,
} from "@flow-state-dev/react";
