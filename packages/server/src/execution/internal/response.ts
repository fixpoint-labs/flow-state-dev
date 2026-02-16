import type { OutputItem } from "@flow-state-dev/core/items";

export function getResponseItems(response: unknown): OutputItem[] {
  if (
    typeof response === "object" &&
    response !== null &&
    "getItems" in response &&
    typeof (response as { getItems?: unknown }).getItems === "function"
  ) {
    return (
      (response as { getItems: () => OutputItem[] }).getItems?.() ?? []
    );
  }

  return [];
}
