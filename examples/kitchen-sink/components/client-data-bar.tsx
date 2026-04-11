"use client";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Activity, User, Brain } from "lucide-react";
import { getPresetOption } from "@/components/model-preset-selector";
import { cn } from "@/lib/utils";

interface ClientDataBarProps {
  currentMode?: string;
  requestCount?: number;
  displayName?: string;
  preferredModel?: string;
  thinkingStyle?: string;
}

export function ClientDataBar({
  currentMode,
  requestCount,
  displayName,
  preferredModel,
  thinkingStyle,
}: ClientDataBarProps) {
  const presetOption = getPresetOption(preferredModel ?? "preset/fast");
  const PresetIcon = presetOption.icon;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-xs">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Activity className="h-3.5 w-3.5" />
        <span>Mode:</span>
        <Badge variant="secondary" className="text-xs">
          {currentMode ?? "chat"}
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
      <Separator orientation="vertical" className="hidden h-4 md:block" />
      <div className="hidden items-center gap-1.5 text-muted-foreground md:flex">
        <PresetIcon className={cn("h-3.5 w-3.5", presetOption.color)} />
        <span>{presetOption.label}</span>
      </div>
      {thinkingStyle && (
        <>
          <Separator orientation="vertical" className="hidden h-4 md:block" />
          <div className="hidden items-center gap-1.5 text-muted-foreground md:flex">
            <Brain className="h-3.5 w-3.5" />
            <span>{thinkingStyle}</span>
          </div>
        </>
      )}
    </div>
  );
}
