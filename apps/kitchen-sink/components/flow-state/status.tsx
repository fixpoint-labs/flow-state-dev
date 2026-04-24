"use client";

import type { StatusItem } from "@flow-state-dev/core/items";
import { Shimmer } from "./shimmer";

export function Status({ item }: { item: StatusItem }) {
  return (
    <div className="px-1 py-2">
      {item.status === "in_progress" ? (
        <Shimmer duration={1.5}>{item.message}</Shimmer>
      ) : (
        <span className="text-sm text-muted-foreground">{item.message}</span>
      )}
    </div>
  );
}
