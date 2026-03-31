"use client";

import { useMemo } from "react";
import type { OutputItem, SourceItem } from "@flow-state-dev/core/items";
import {
  Sources,
  SourcesTrigger,
  SourcesContent,
  Source,
} from "@/components/ai-elements/sources";

export function SourcesGroupAdapter({ items }: { items: OutputItem[] }) {
  const sources = useMemo(
    () => items.filter((item): item is SourceItem => item.type === "source"),
    [items]
  );

  if (sources.length === 0) return null;

  return (
    <div>
      <Sources>
        <SourcesTrigger count={sources.length} />
        <SourcesContent>
          {sources.map((source) => (
            <Source key={source.id} href={source.url}>
              {source.title}
            </Source>
          ))}
        </SourcesContent>
      </Sources>
    </div>
  );
}
