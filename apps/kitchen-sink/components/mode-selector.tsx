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
import { MessageCircleQuestion, Hammer, Mic, Swords, ChevronDownIcon } from "lucide-react";

export type Mode = "ask" | "build" | "interview" | "debate";

interface ModeOption {
  value: Mode;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    value: "ask",
    label: "Ask",
    description: "Questions, answers, and reasoning. Memory-first.",
    icon: MessageCircleQuestion,
    color: "text-blue-500 dark:text-blue-400",
  },
  {
    value: "build",
    label: "Build",
    description: "File-writing, app-building, agentic execution.",
    icon: Hammer,
    color: "text-amber-500 dark:text-amber-400",
  },
  {
    value: "interview",
    label: "Interview",
    description: "Structured questioning to extract knowledge and context.",
    icon: Mic,
    color: "text-emerald-500 dark:text-emerald-400",
  },
  {
    value: "debate",
    label: "Debate",
    description: "Adversarial challenge to stress-test your ideas.",
    icon: Swords,
    color: "text-rose-500 dark:text-rose-400",
  },
];

export function getModeOption(value: Mode): ModeOption {
  return MODE_OPTIONS.find((o) => o.value === value) ?? MODE_OPTIONS[0];
}

interface ModeSelectorProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  disabled?: boolean;
}

export function ModeSelector({ mode, onModeChange, disabled }: ModeSelectorProps) {
  const active = getModeOption(mode);
  const ActiveIcon = active.icon;

  const handleValueChange = useCallback(
    (v: string) => onModeChange(v as Mode),
    [onModeChange],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          data-testid="mode-selector"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn(
            "gap-1.5 text-xs font-medium transition-colors",
            "hover:border-foreground/20",
          )}
        >
          <ActiveIcon className={cn("size-3.5", active.color)} />
          <span className="hidden sm:inline">{active.label}</span>
          <ChevronDownIcon className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Mode
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={mode} onValueChange={handleValueChange}>
          {MODE_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isActive = mode === option.value;

            return (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                className="flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5"
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
