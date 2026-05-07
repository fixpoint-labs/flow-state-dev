"use client";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { User, Cpu, Wand2 } from "lucide-react";
import { getStyleOption } from "@/components/thinking-style-selector";
import { cn } from "@/lib/utils";

interface ClientDataBarProps {
  displayName?: string;
  /** Concrete gateway model string the user has selected. */
  selectedModel?: string;
  /** The user's thinking style selection ("auto", "default", etc.). */
  thinkingStyleMode?: string;
  /** The resolved thinking style from the most recent request. */
  thinkingStyle?: string;
  /**
   * Skills activated by `intentSelector` for the most recent turn (FIX-421).
   * Each entry carries the skill name and the tier that matched it
   * (`slash` / `keyword` / `classifier`).
   */
  activeSkills?: Array<{ name: string; source: string }>;
}

export function ClientDataBar({
  displayName,
  selectedModel,
  thinkingStyleMode,
  thinkingStyle,
  activeSkills,
}: ClientDataBarProps) {
  // Only show resolved thinking style when user selected "auto".
  const showThinkingStyle = thinkingStyleMode === "auto" && thinkingStyle;
  const styleOption = showThinkingStyle ? getStyleOption(thinkingStyle as any) : null;
  const StyleIcon = styleOption?.icon;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-xs">
      <div className="hidden items-center gap-1.5 text-muted-foreground sm:flex">
        <User className="h-3.5 w-3.5" />
        <span>{displayName ?? "Developer"}</span>
      </div>
      {selectedModel && (
        <>
          <Separator orientation="vertical" className="hidden h-4 md:block" />
          <div className="hidden items-center gap-1.5 text-muted-foreground md:flex">
            <Cpu className="h-3.5 w-3.5" />
            <span>{selectedModel}</span>
          </div>
        </>
      )}
      {showThinkingStyle && StyleIcon && (
        <>
          <Separator orientation="vertical" className="hidden h-4 md:block" />
          <div className="hidden items-center gap-1.5 text-muted-foreground md:flex">
            <StyleIcon className={cn("h-3.5 w-3.5", styleOption.color)} />
            <span>{styleOption.label}</span>
          </div>
        </>
      )}
      {activeSkills && activeSkills.length > 0 && (
        <>
          <Separator orientation="vertical" className="hidden h-4 md:block" />
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Wand2 className="h-3.5 w-3.5 text-purple-500" />
            <span className="hidden sm:inline">Skill{activeSkills.length > 1 ? "s" : ""}:</span>
            <div className="flex flex-wrap items-center gap-1">
              {activeSkills.map((s) => (
                <Badge key={s.name} variant="outline" className="text-xs">
                  {s.name}
                  <span className="ml-1 opacity-60">· {s.source}</span>
                </Badge>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
