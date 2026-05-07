"use client";

import type { BlockTraceItem } from "@flow-state-dev/core/items";
import type { BlockValueInternal } from "@flow-state-dev/core/items/internal";
import { Tool } from "@/components/flow-state/tool";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type AgentOutput = {
  reply: string;
  reasoning: string | null;
  artifactsModified: string[];
};

/**
 * Extract the resolved payload from a BlockValue. For this card we only care
 * about the inline case — the agent generator is a leaf that produces novel
 * content, so its block_output always carries `kind: "inline"` (FIX-413).
 * Defensive fallback for any legacy/ref shapes just returns undefined.
 */
function unwrapInline(value: BlockValueInternal<unknown> | undefined): AgentOutput | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "object" && "kind" in value && value.kind === "inline") {
    return value.value as AgentOutput;
  }
  return undefined;
}

export function AgentResponseCard({ item }: { item: BlockTraceItem }) {
  // Tool calls get rendered via the flow-state Tool component
  if (item.toolCall) {
    return <Tool item={item} />;
  }

  // Show skeleton placeholder while block is still executing
  const output = unwrapInline(item.output);
  if (item.status === "in_progress" && !output?.reply) {
    return (
      <Card className="animate-pulse opacity-80">
        <CardHeader className="pb-3">
          <CardTitle className="text-muted-foreground">{item.blockName}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-4 w-3/4 rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }

  // Skip outputs with no displayable reply
  if (!output?.reply) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle>{item.blockName}</CardTitle>
          <Badge variant="secondary" className="text-xs">
            {item.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{output.reply}</p>
        {output.artifactsModified && output.artifactsModified.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Modified:</span>
            {output.artifactsModified.map((id) => (
              <Badge key={id} variant="outline" className="text-xs">
                {id}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
