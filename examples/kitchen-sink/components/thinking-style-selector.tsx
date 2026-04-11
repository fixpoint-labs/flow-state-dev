"use client";

import { useCallback } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  ListChecks,
  Users,
  Brain,
  ChevronDownIcon,
} from "lucide-react";

export type ThinkingStyle = "auto" | "plan-and-execute" | "supervisor" | "chain-of-thought";

interface StyleOption {
  value: ThinkingStyle;
  label: string;
  shortLabel: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const STYLE_OPTIONS: StyleOption[] = [
  {
    value: "auto",
    label: "Auto",
    shortLabel: "Auto",
    description: "Automatically selects the best approach",
    icon: Sparkles,
    color: "text-violet-500 dark:text-violet-400",
  },
  {
    value: "plan-and-execute",
    label: "Plan & Execute",
    shortLabel: "Plan",
    description: "Decomposes into tasks before generation",
    icon: ListChecks,
    color: "text-blue-500 dark:text-blue-400",
  },
  {
    value: "supervisor",
    label: "Supervisor",
    shortLabel: "Supervisor",
    description: "Orchestrates sub-agents with review",
    icon: Users,
    color: "text-amber-500 dark:text-amber-400",
  },
  {
    value: "chain-of-thought",
    label: "Chain of Thought",
    shortLabel: "CoT",
    description: "Extended reasoning with visible thinking",
    icon: Brain,
    color: "text-emerald-500 dark:text-emerald-400",
  },
];

export function getStyleOption(value: ThinkingStyle): StyleOption {
  return STYLE_OPTIONS.find((o) => o.value === value) ?? STYLE_OPTIONS[0];
}

interface ThinkingStyleSelectorProps {
  value: ThinkingStyle;
  onValueChange: (value: ThinkingStyle) => void;
  disabled?: boolean;
}

export function ThinkingStyleSelector({
  value,
  onValueChange,
  disabled,
}: ThinkingStyleSelectorProps) {
  const active = getStyleOption(value);
  const ActiveIcon = active.icon;

  const handleValueChange = useCallback(
    (v: string) => onValueChange(v as ThinkingStyle),
    [onValueChange],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn(
            "gap-1.5 text-xs font-medium transition-colors",
            "hover:border-foreground/20",
          )}
        >
          <ActiveIcon className={cn("size-3.5", active.color)} />
          <span className="hidden sm:inline">{active.shortLabel}</span>
          <ChevronDownIcon className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Thinking Style
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={value} onValueChange={handleValueChange}>
          {STYLE_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isActive = value === option.value;

            return (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5",
                  isActive && "bg-accent",
                )}
              >
                <Icon
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    isActive ? option.color : "text-muted-foreground",
                  )}
                />
                <div className="flex flex-col gap-0.5">
                  <span className={cn("text-sm font-medium leading-none", isActive && "text-foreground")}>
                    {option.label}
                  </span>
                  <span className="text-xs leading-snug text-muted-foreground">
                    {option.description}
                  </span>
                </div>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
