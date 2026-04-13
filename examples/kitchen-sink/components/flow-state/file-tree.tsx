"use client";

/**
 * Tree-structured file and folder display with expand/collapse and selection.
 *
 * Context-based state management supports both controlled (`expanded` prop)
 * and uncontrolled (`defaultExpanded`) expansion modes. Keyboard accessible
 * with `role="tree"` and `role="treeitem"` + Enter/Space handlers.
 *
 * Ported from Vercel AI Elements `FileTree` component and adapted for
 * the @flow-state-dev/ui registry conventions.
 */

import type { HTMLAttributes, ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface FileTreeContextType {
  expandedPaths: Set<string>;
  togglePath: (path: string) => void;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

const FileTreeContext = createContext<FileTreeContextType>({
  expandedPaths: new Set(),
  togglePath: () => {},
  selectedPath: null,
  onSelect: () => {},
});

// ---------------------------------------------------------------------------
// FileTree — root provider
// ---------------------------------------------------------------------------

export interface FileTreeProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  /** Currently selected file path. */
  selectedPath?: string | null;
  /** Called when a file node is clicked. */
  onSelect?: (path: string) => void;
  /** Controlled expanded paths. */
  expanded?: Set<string>;
  /** Initial expanded paths (uncontrolled). */
  defaultExpanded?: Set<string>;
}

export function FileTree({
  selectedPath = null,
  onSelect,
  expanded,
  defaultExpanded,
  className,
  children,
  ...props
}: FileTreeProps) {
  const [internalExpanded, setInternalExpanded] = useState<Set<string>>(
    () => defaultExpanded ?? new Set(),
  );

  const expandedPaths = expanded ?? internalExpanded;

  const togglePath = useCallback(
    (path: string) => {
      if (expanded) return; // controlled — parent manages state
      setInternalExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
    },
    [expanded],
  );

  const handleSelect = useCallback(
    (path: string) => {
      onSelect?.(path);
    },
    [onSelect],
  );

  const ctx = useMemo(
    () => ({
      expandedPaths,
      togglePath,
      selectedPath,
      onSelect: handleSelect,
    }),
    [expandedPaths, togglePath, selectedPath, handleSelect],
  );

  return (
    <FileTreeContext.Provider value={ctx}>
      <div
        role="tree"
        className={cn("text-sm", className)}
        {...props}
      >
        {children}
      </div>
    </FileTreeContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// FileTreeFolder — collapsible folder node
// ---------------------------------------------------------------------------

export interface FileTreeFolderProps {
  /** Unique path for this folder (used for expand/collapse tracking). */
  path: string;
  /** Display name. */
  name: string;
  /** Custom icon (replaces default folder icon). */
  icon?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function FileTreeFolder({
  path,
  name,
  icon,
  className,
  children,
}: FileTreeFolderProps) {
  const { expandedPaths, togglePath } = useContext(FileTreeContext);
  const isExpanded = expandedPaths.has(path);

  return (
    <Collapsible open={isExpanded} onOpenChange={() => togglePath(path)}>
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm hover:bg-accent",
          className,
        )}
        role="treeitem"
        aria-expanded={isExpanded}
      >
        <ChevronRightIcon
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            isExpanded && "rotate-90",
          )}
        />
        <FileTreeIcon>
          {icon ??
            (isExpanded ? (
              <FolderOpenIcon className="h-4 w-4 text-blue-500" />
            ) : (
              <FolderIcon className="h-4 w-4 text-blue-500" />
            ))}
        </FileTreeIcon>
        <FileTreeName>{name}</FileTreeName>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 border-l pl-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// FileTreeFile — selectable file node
// ---------------------------------------------------------------------------

export interface FileTreeFileProps {
  /** Unique path/id for this file (used for selection tracking). */
  path: string;
  /** Display name. */
  name: string;
  /** Custom icon (replaces default file icon). */
  icon?: ReactNode;
  className?: string;
}

export function FileTreeFile({
  path,
  name,
  icon,
  className,
}: FileTreeFileProps) {
  const { selectedPath, onSelect } = useContext(FileTreeContext);
  const isSelected = selectedPath === path;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(path);
      }
    },
    [onSelect, path],
  );

  return (
    <button
      type="button"
      role="treeitem"
      aria-selected={isSelected}
      tabIndex={0}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors",
        isSelected
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        className,
      )}
      onClick={() => onSelect(path)}
      onKeyDown={handleKeyDown}
    >
      <FileTreeIcon>
        {icon ?? <FileIcon className="h-4 w-4 text-muted-foreground" />}
      </FileTreeIcon>
      <FileTreeName>{name}</FileTreeName>
    </button>
  );
}

// ---------------------------------------------------------------------------
// FileTreeIcon — icon wrapper
// ---------------------------------------------------------------------------

export const FileTreeIcon = ({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn("shrink-0", className)} {...props} />
);

// ---------------------------------------------------------------------------
// FileTreeName — truncated name span
// ---------------------------------------------------------------------------

export const FileTreeName = ({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn("truncate", className)} {...props} />
);

// ---------------------------------------------------------------------------
// FileTreeActions — action container (stops event propagation)
// ---------------------------------------------------------------------------

export const FileTreeActions = ({
  className,
  onClick,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("ml-auto flex items-center gap-1", className)}
    onClick={(e) => {
      e.stopPropagation();
      onClick?.(e);
    }}
    onKeyDown={(e) => e.stopPropagation()}
    {...props}
  />
);
