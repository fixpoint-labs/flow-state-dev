/**
 * Segmented — minimal two-or-more-option toggle used in the top bar.
 *
 * Generic over the option string union so callers get a typed `onChange`
 * signature without casting.
 */
"use client";

import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

type SegmentedOption<T extends string> = {
  readonly value: T;
  readonly label: string;
  readonly title?: string;
};

type SegmentedProps<T extends string> = {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
};

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: SegmentedProps<T>): ReactElement {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
        {label}
      </span>
      <div
        className={cn(
          "inline-flex h-7 items-center rounded-md border p-0.5",
          "border-[color:var(--c-border)] bg-[color:var(--c-surface-2)]",
        )}
        role="radiogroup"
        aria-label={label}
      >
        {options.map((opt) => {
          const isSelected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              title={opt.title}
              onClick={() => {
                if (!isSelected) onChange(opt.value);
              }}
              className={cn(
                "h-6 rounded px-2 font-mono text-[11px]",
                isSelected
                  ? "bg-[color:var(--c-surface)] text-[color:var(--c-fg)]"
                  : "text-[color:var(--c-fg-muted)] hover:text-[color:var(--c-fg)]",
                disabled && "opacity-50 cursor-not-allowed",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
