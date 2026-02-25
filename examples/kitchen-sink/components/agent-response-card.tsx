"use client";

import type { BlockOutputItem } from "@flow-state-dev/core/items";
import { KitchenSinkToolCall } from "./kitchen-sink-tool-call";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type AgentOutput = {
  reply: string;
  reasoning: string | null;
  artifactsModified: string[];
};

export function AgentResponseCard({ item }: { item: BlockOutputItem }) {
  // Tool calls get rendered via the AI Elements Tool component
  if (item.toolCall) {
    return <KitchenSinkToolCall item={item} />;
  }

  // Show skeleton placeholder while block is still executing
  const output = item.output as AgentOutput | undefined;
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
