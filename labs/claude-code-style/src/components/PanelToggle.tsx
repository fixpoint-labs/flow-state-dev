import { PanelLeftIcon, PanelRightIcon } from "lucide-react";
import { cn } from "../lib/utils";

/**
 * The control that collapses a side column, or opens it back: a panel icon
 * with the collapsing column's side marked, the same one on the column and on
 * its collapsed rail or strip. Named for what it does next, with its key.
 *
 * @param side Which side of the screen the column is on.
 * @param name What the column is called, for the control's name.
 * @param keyName The key that does the same.
 */
export function PanelToggle({ side, name, keyName, collapsed, onToggle, className }: {
  side: "left" | "right";
  name: string;
  keyName: string;
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const label = `${collapsed ? "Expand" : "Collapse"} ${name}`;
  const Icon = side === "left" ? PanelLeftIcon : PanelRightIcon;
  return (
    <button
      type="button"
      onClick={onToggle}
      title={`${label} (${keyName})`}
      aria-label={label}
      aria-expanded={!collapsed}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      <Icon aria-hidden className="size-4" />
    </button>
  );
}
