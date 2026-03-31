"use client";

import { useMemo } from "react";
import type { OutputItem, SourceItem } from "@flow-state-dev/core/items";
import { Sources } from "@/src/components/flow-state/sources";

export function SourcesGroup({ items }: { items: OutputItem[] }) {
  const sources = useMemo(
    () => items.filter((item): item is SourceItem => item.type === "source"),
    [items]
  );

  if (sources.length === 0) return null;

  return (
    <div>
      <Sources
        items={sources.map((source) => ({
          href: source.url,
          id: source.id,
          title: source.title,
        }))}
      />
    </div>
  );
}
