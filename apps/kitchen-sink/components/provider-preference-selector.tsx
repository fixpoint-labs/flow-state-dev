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
import { Sparkles, ChevronDownIcon } from "lucide-react";

export type ProviderPreference = "" | "anthropic" | "openai" | "google";

interface ProviderOption {
  value: ProviderPreference;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    value: "",
    label: "No preference",
    shortLabel: "Any",
    description: "Use the preset's natural ordering",
    color: "text-muted-foreground",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    shortLabel: "Anthropic",
    description: "Prefer Claude models when available",
    color: "text-orange-500 dark:text-orange-400",
  },
  {
    value: "openai",
    label: "OpenAI",
    shortLabel: "OpenAI",
    description: "Prefer GPT models when available",
    color: "text-emerald-500 dark:text-emerald-400",
  },
  {
    value: "google",
    label: "Google",
    shortLabel: "Google",
    description: "Prefer Gemini models when available",
    color: "text-sky-500 dark:text-sky-400",
  },
];

export function getProviderOption(value: string): ProviderOption {
  return (
    PROVIDER_OPTIONS.find((o) => o.value === value) ?? PROVIDER_OPTIONS[0]
  );
}

interface ProviderPreferenceSelectorProps {
  value: string;
  onValueChange: (value: ProviderPreference) => void;
  disabled?: boolean;
}

export function ProviderPreferenceSelector({
  value,
  onValueChange,
  disabled,
}: ProviderPreferenceSelectorProps) {
  const active = getProviderOption(value);

  const handleValueChange = useCallback(
    (v: string) => onValueChange(v as ProviderPreference),
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
          <Sparkles className={cn("size-3.5", active.color)} />
          <span className="hidden sm:inline">{active.shortLabel}</span>
          <ChevronDownIcon className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Provider preference
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={handleValueChange}
        >
          {PROVIDER_OPTIONS.map((option) => (
            <ProviderItem
              key={option.value}
              option={option}
              isActive={value === option.value}
            />
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProviderItem({
  option,
  isActive,
}: {
  option: ProviderOption;
  isActive: boolean;
}) {
  return (
    <DropdownMenuRadioItem
      value={option.value}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5",
        isActive && "bg-accent",
      )}
    >
      <Sparkles
        className={cn(
          "mt-0.5 size-4 shrink-0",
          isActive ? option.color : "text-muted-foreground",
        )}
      />
      <div className="flex flex-col gap-0.5">
        <span
          className={cn(
            "text-sm font-medium leading-none",
            isActive && "text-foreground",
          )}
        >
          {option.label}
        </span>
        <span className="text-xs leading-snug text-muted-foreground">
          {option.description}
        </span>
      </div>
    </DropdownMenuRadioItem>
  );
}
