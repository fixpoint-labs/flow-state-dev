/**
 * PortfolioSectionNav — the portfolio pane's perspective switcher (FIX-885).
 * Two renderings of one section list, CSS-picked by the `lg` breakpoint (both
 * render, the FIX-757 shell precedent — no useMediaQuery): a desktop left rail
 * (the `MemoSidebar` idiom) and a mobile horizontal segmented strip (the
 * `TopBar` nav idiom — deliberately NOT a drawer; the mobile shell already has
 * a bottom nav, and a second hidden nav layer would bury the perspectives).
 *
 * Page-level section nav, so `<nav>` + `aria-current`, not `role="tablist"`.
 * FIX-762's household health view lands by appending one `SECTIONS` entry and
 * one union member.
 */
"use client";

import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

/** The portfolio pane's perspectives (the `TradingDeskView` precedent). */
export type PortfolioSection = "accounts" | "gains";

const SECTIONS: ReadonlyArray<{ value: PortfolioSection; label: string }> = [
  { value: "accounts", label: "Accounts" },
  { value: "gains", label: "Gains & Taxes" },
];

type SectionNavProps = {
  value: PortfolioSection;
  onChange: (section: PortfolioSection) => void;
};

/** Desktop left rail — inline sidebar, hidden below `lg`. */
export function PortfolioSectionRail({
  value,
  onChange,
}: SectionNavProps): ReactElement {
  return (
    <nav
      aria-label="Portfolio sections"
      className="hidden w-[180px] shrink-0 overflow-y-auto border-r border-[color:var(--c-border)] bg-[color:var(--c-surface)] lg:block"
    >
      <ul className="flex flex-col gap-0.5 px-2 pt-3">
        {SECTIONS.map((section) => {
          const isSelected = section.value === value;
          return (
            <li key={section.value}>
              <button
                type="button"
                aria-current={isSelected ? "page" : undefined}
                onClick={() => {
                  if (!isSelected) onChange(section.value);
                }}
                className={cn(
                  "flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12px]",
                  isSelected
                    ? "bg-[color:var(--c-surface-2)] text-[color:var(--c-fg)]"
                    : "text-[color:var(--c-fg-muted)] hover:bg-[color:var(--c-surface-2)]/60",
                )}
              >
                {section.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Mobile horizontal strip — a pinned segmented row, hidden at `lg` and above. */
export function PortfolioSectionStrip({
  value,
  onChange,
}: SectionNavProps): ReactElement {
  return (
    <nav
      aria-label="Portfolio sections"
      className="flex items-center border-b border-[color:var(--c-border)] px-4 py-1.5 lg:hidden"
    >
      <div className="flex items-center gap-0.5 rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] p-0.5">
        {SECTIONS.map((section) => {
          const isSelected = section.value === value;
          return (
            <button
              key={section.value}
              type="button"
              aria-current={isSelected ? "page" : undefined}
              onClick={() => {
                if (!isSelected) onChange(section.value);
              }}
              className={cn(
                "h-6 rounded px-2.5 text-[11.5px] font-medium",
                isSelected
                  ? "bg-[color:var(--c-surface)] text-[color:var(--c-fg)]"
                  : "text-[color:var(--c-fg-muted)] hover:text-[color:var(--c-fg)]",
              )}
            >
              {section.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
