"use client";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Activity, User, Brain, Cpu } from "lucide-react";
import { getPresetOption } from "@/components/model-preset-selector";
import { getStyleOption } from "@/components/thinking-style-selector";
import { cn } from "@/lib/utils";

interface ClientDataBarProps {
  currentMode?: string;
  requestCount?: number;
  displayName?: string;
  preferredModel?: string;
  /** Actual model string returned by the provider (e.g. "claude-sonnet-4-5"). */
  resolvedModel?: string;
  /** The user's thinking style selection ("auto", "default", etc.). */
  thinkingStyleMode?: string;
  /** The resolved thinking style from the most recent request. */
  thinkingStyle?: string;
}

export function ClientDataBar({
  currentMode,
  requestCount,
  displayName,
  resolvedModel,
  thinkingStyleMode,
  thinkingStyle,
}: ClientDataBarProps) {
  // Only show resolved thinking style when user selected "auto".
  const showThinkingStyle = thinkingStyleMode === "auto" && thinkingStyle;
  const styleOption = showThinkingStyle ? getStyleOption(thinkingStyle as any) : null;
  const StyleIcon = styleOption?.icon;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-xs">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Activity className="h-3.5 w-3.5" />
        <span>Mode:</span>
        <Badge variant="secondary" className="text-xs">
          {currentMode ?? "ask"}
        </Badge>
      </div>
      <Separator orientation="vertical" className="hidden h-4 sm:block" />
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span>Requests:</span>
        <Badge variant="outline" className="text-xs">
          {requestCount ?? 0}
        </Badge>
      </div>
      <Separator orientation="vertical" className="hidden h-4 md:block" />
      <div className="hidden items-center gap-1.5 text-muted-foreground sm:flex">
        <User className="h-3.5 w-3.5" />
        <span>{displayName ?? "Developer"}</span>
      </div>
      {resolvedModel && (
        <>
          <Separator orientation="vertical" className="hidden h-4 md:block" />
        <div className="hidden items-center gap-1.5 text-muted-foreground md:flex">
            <Cpu className="h-3.5 w-3.5" />
            <span>{resolvedModel}</span>
          </div>
        </>
      ) }
      {showThinkingStyle && StyleIcon && (
        <>
          <Separator orientation="vertical" className="hidden h-4 md:block" />
          <div className="hidden items-center gap-1.5 text-muted-foreground md:flex">
            <StyleIcon className={cn("h-3.5 w-3.5", styleOption.color)} />
            <span>{styleOption.label}</span>
          </div>
        </>
      )}
    </div>
  );
}
