"use client";

import { useCallback } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Settings2, ShieldCheck, Terminal, ChevronDownIcon } from "lucide-react";

export interface Features {
  biasCheck: boolean;
  bashTool: boolean;
}

export const DEFAULT_FEATURES: Features = {
  biasCheck: false,
  bashTool: true,
};

interface FeatureOption {
  key: keyof Features;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const FEATURE_OPTIONS: FeatureOption[] = [
  {
    key: "bashTool",
    label: "Bash Tool",
    description: "Execute commands and manage files in a sandbox workspace",
    icon: Terminal,
    color: "text-emerald-500 dark:text-emerald-400",
  },
  {
    key: "biasCheck",
    label: "Bias Check",
    description: "Detect sycophancy and cognitive biases in responses",
    icon: ShieldCheck,
    color: "text-rose-500 dark:text-rose-400",
  },
];

interface FeatureSelectorProps {
  features: Features;
  onFeaturesChange: (features: Features) => void;
  disabled?: boolean;
}

export function FeatureSelector({
  features,
  onFeaturesChange,
  disabled,
}: FeatureSelectorProps) {
  const activeCount = Object.values(features).filter(Boolean).length;

  const handleToggle = useCallback(
    (key: keyof Features) => {
      onFeaturesChange({ ...features, [key]: !features[key] });
    },
    [features, onFeaturesChange],
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
            activeCount > 0 && "border-rose-500/30 dark:border-rose-400/30",
          )}
        >
          <Settings2
            className={cn(
              "size-3.5",
              activeCount > 0
                ? "text-rose-500 dark:text-rose-400"
                : "text-muted-foreground",
            )}
          />
          <span className="hidden sm:inline">
            {activeCount > 0 ? `Features (${activeCount})` : "Features"}
          </span>
          <ChevronDownIcon className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Features
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {FEATURE_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isChecked = features[option.key];

          return (
            <DropdownMenuCheckboxItem
              key={option.key}
              checked={isChecked}
              onCheckedChange={() => handleToggle(option.key)}
              className="flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5"
            >
              <Icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  isChecked ? option.color : "text-muted-foreground",
                )}
              />
              <div className="flex flex-col gap-0.5">
                <span
                  className={cn(
                    "text-sm font-medium leading-none",
                    isChecked && "text-foreground",
                  )}
                >
                  {option.label}
                </span>
                <span className="text-xs leading-snug text-muted-foreground">
                  {option.description}
                </span>
              </div>
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
