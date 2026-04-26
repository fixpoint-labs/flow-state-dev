"use client";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Activity, User, Brain, Cpu, Sparkles, Wand2 } from "lucide-react";
import { getPresetOption } from "@/components/model-preset-selector";
import { getStyleOption } from "@/components/thinking-style-selector";
import { getProviderOption } from "@/components/provider-preference-selector";
import { cn } from "@/lib/utils";

interface ClientDataBarProps {
  currentMode?: string;
  requestCount?: number;
  displayName?: string;
  preferredModel?: string;
  /** Actual model string returned by the provider (e.g. "claude-sonnet-4-5"). */
  resolvedModel?: string;
  /** Preferred provider brand — "" when no preference. */
  preferredProvider?: string;
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
  currentMode,
  requestCount,
  displayName,
  resolvedModel,
  preferredProvider,
  thinkingStyleMode,
  thinkingStyle,
  activeSkills,
}: ClientDataBarProps) {
  // Only show resolved thinking style when user selected "auto".
  const showThinkingStyle = thinkingStyleMode === "auto" && thinkingStyle;
  const styleOption = showThinkingStyle ? getStyleOption(thinkingStyle as any) : null;
  const StyleIcon = styleOption?.icon;

  // Only badge the provider preference when it's non-empty ("" = no preference).
  const showProviderPreference =
    preferredProvider !== undefined && preferredProvider !== "";
  const providerOption = showProviderPreference
    ? getProviderOption(preferredProvider)
    : null;

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
      {providerOption && (
        <>
          <Separator orientation="vertical" className="hidden h-4 md:block" />
          <div className="hidden items-center gap-1.5 text-muted-foreground md:flex">
            <Sparkles className={cn("h-3.5 w-3.5", providerOption.color)} />
            <span>{providerOption.label}</span>
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
