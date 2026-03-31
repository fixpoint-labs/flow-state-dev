"use client";

import type { StatusItem } from "@flow-state-dev/core/items";
import { Shimmer } from "@/components/ai-elements/shimmer";

export function StatusAdapter({ item }: { item: StatusItem }) {
  return (
    <div className="px-1 py-2">
      <Shimmer duration={1.5}>{item.message}</Shimmer>
    </div>
  );
}
