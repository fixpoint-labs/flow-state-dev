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
  Zap,
  Minimize2,
  Gauge,
  Crown,
  Brain,
  ChevronDownIcon,
  Cpu,
} from "lucide-react";

export type ModelPreset =
  | "preset/fast"
  | "preset/small"
  | "preset/medium"
  | "preset/large"
  | "preset/thinking-small"
  | "preset/thinking-medium"
  | "preset/thinking-large";

interface PresetOption {
  value: ModelPreset;
  label: string;
  shortLabel: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  group: "standard" | "thinking";
}

const PRESET_OPTIONS: PresetOption[] = [
  {
    value: "preset/fast",
    label: "Fast",
    shortLabel: "Fast",
    description: "Quick responses, lower cost",
    icon: Zap,
    color: "text-green-500 dark:text-green-400",
    group: "standard",
  },
  {
    value: "preset/small",
    label: "Small",
    shortLabel: "Small",
    description: "Compact output, token-limited",
    icon: Minimize2,
    color: "text-sky-500 dark:text-sky-400",
    group: "standard",
  },
  {
    value: "preset/medium",
    label: "Medium",
    shortLabel: "Medium",
    description: "Balanced quality and speed",
    icon: Gauge,
    color: "text-orange-500 dark:text-orange-400",
    group: "standard",
  },
  {
    value: "preset/large",
    label: "Large",
    shortLabel: "Large",
    description: "Highest quality, most capable",
    icon: Crown,
    color: "text-purple-500 dark:text-purple-400",
    group: "standard",
  },
  {
    value: "preset/thinking-small",
    label: "Small",
    shortLabel: "Think S",
    description: "Extended reasoning, standard models",
    icon: Brain,
    color: "text-teal-500 dark:text-teal-400",
    group: "thinking",
  },
  {
    value: "preset/thinking-medium",
    label: "Medium",
    shortLabel: "Think M",
    description: "Extended reasoning, balanced",
    icon: Brain,
    color: "text-indigo-500 dark:text-indigo-400",
    group: "thinking",
  },
  {
    value: "preset/thinking-large",
    label: "Large",
    shortLabel: "Think L",
    description: "Extended reasoning, most capable",
    icon: Brain,
    color: "text-rose-500 dark:text-rose-400",
    group: "thinking",
  },
];

export function getPresetOption(value: string): PresetOption {
  return PRESET_OPTIONS.find((o) => o.value === value) ?? PRESET_OPTIONS[0];
}

interface ModelPresetSelectorProps {
  value: string;
  onValueChange: (value: ModelPreset) => void;
  disabled?: boolean;
}

export function ModelPresetSelector({
  value,
  onValueChange,
  disabled,
}: ModelPresetSelectorProps) {
  const active = getPresetOption(value);
  const ActiveIcon = active.icon;

  const standardPresets = PRESET_OPTIONS.filter((o) => o.group === "standard");
  const thinkingPresets = PRESET_OPTIONS.filter((o) => o.group === "thinking");

  const handleValueChange = useCallback(
    (v: string) => onValueChange(v as ModelPreset),
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
          <Cpu className={cn("size-3.5", active.color)} />
          <span className="hidden sm:inline">{active.shortLabel}</span>
          <ChevronDownIcon className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Standard
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={value} onValueChange={handleValueChange}>
          {standardPresets.map((option) => (
            <PresetItem key={option.value} option={option} isActive={value === option.value} />
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Thinking
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={value} onValueChange={handleValueChange}>
          {thinkingPresets.map((option) => (
            <PresetItem key={option.value} option={option} isActive={value === option.value} />
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PresetItem({ option, isActive }: { option: PresetOption; isActive: boolean }) {
  const Icon = option.icon;
  return (
    <DropdownMenuRadioItem
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
}
