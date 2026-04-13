"use client";

/**
 * Live JSX/TSX renderer with streaming support and error fallback.
 *
 * During streaming, unclosed tags are auto-completed so the parser doesn't
 * choke on partial output. A `lastGoodJsx` fallback displays the last
 * successful render while the current parse fails.
 *
 * Ported from Vercel AI Elements `JSXPreview` component and adapted for
 * the @flow-state-dev/ui registry conventions.
 */

import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";
import { AlertTriangleIcon } from "lucide-react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import JsxParser from "react-jsx-parser";

// ---------------------------------------------------------------------------
// Tag completion for streaming — auto-close unclosed tags
// ---------------------------------------------------------------------------

function completeJsxTag(jsx: string): string {
  const openTags: string[] = [];
  // Match self-closing, opening, and closing tags
  const tagRegex = /<\/?([A-Za-z][A-Za-z0-9.]*)[^>]*\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(jsx)) !== null) {
    const full = match[0];
    const tagName = match[1];
    if (full.startsWith("</")) {
      // closing tag — pop matching open
      const idx = openTags.lastIndexOf(tagName);
      if (idx !== -1) openTags.splice(idx, 1);
    } else if (!full.endsWith("/>")) {
      // opening tag (not self-closing)
      openTags.push(tagName);
    }
  }
  // Close remaining tags in reverse order
  let result = jsx;
  for (let i = openTags.length - 1; i >= 0; i--) {
    result += `</${openTags[i]}>`;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface JSXPreviewContextType {
  jsx: string;
  completedJsx: string;
  isStreaming: boolean;
  components: Record<string, ComponentType<any>>;
  bindings: Record<string, unknown>;
  error: Error | null;
  setError: (error: Error | null) => void;
  lastGoodJsx: string | null;
}

const JSXPreviewContext = createContext<JSXPreviewContextType>({
  jsx: "",
  completedJsx: "",
  isStreaming: false,
  components: {},
  bindings: {},
  error: null,
  setError: () => {},
  lastGoodJsx: null,
});

// ---------------------------------------------------------------------------
// JSXPreview — root provider
// ---------------------------------------------------------------------------

export interface JSXPreviewProps {
  /** Raw JSX/TSX string to render. */
  jsx: string;
  /** Whether JSX is still being streamed (enables tag auto-completion). */
  isStreaming?: boolean;
  /** Map of component names available inside the JSX. */
  components?: Record<string, ComponentType<any>>;
  /** Map of variable bindings available inside the JSX. */
  bindings?: Record<string, unknown>;
  /** Called when a render error occurs. */
  onError?: (error: Error) => void;
  children?: ReactNode;
  className?: string;
}

export function JSXPreview({
  jsx,
  isStreaming = false,
  components = {},
  bindings = {},
  onError,
  children,
  className,
}: JSXPreviewProps) {
  const [error, setErrorState] = useState<Error | null>(null);
  const lastGoodRef = useRef<string | null>(null);

  const completedJsx = useMemo(
    () => (isStreaming ? completeJsxTag(jsx) : jsx),
    [jsx, isStreaming],
  );

  const setError = useCallback(
    (err: Error | null) => {
      setErrorState(err);
      if (err) {
        onError?.(err);
      } else {
        lastGoodRef.current = completedJsx;
      }
    },
    [onError, completedJsx],
  );

  // Track last good JSX
  if (!error) {
    lastGoodRef.current = completedJsx;
  }

  const ctx = useMemo(
    () => ({
      jsx,
      completedJsx,
      isStreaming,
      components,
      bindings,
      error,
      setError,
      lastGoodJsx: lastGoodRef.current,
    }),
    [jsx, completedJsx, isStreaming, components, bindings, error, setError],
  );

  return (
    <JSXPreviewContext.Provider value={ctx}>
      <div className={cn("relative", className)}>{children}</div>
    </JSXPreviewContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// JSXPreviewContent — renders via react-jsx-parser
// ---------------------------------------------------------------------------

export const JSXPreviewContent = memo(function JSXPreviewContent({
  className,
}: {
  className?: string;
}) {
  const { completedJsx, lastGoodJsx, components, bindings, setError } =
    useContext(JSXPreviewContext);

  const jsxToRender = completedJsx || lastGoodJsx || "";

  const handleError = useCallback(
    (err: Error) => {
      setError(err);
    },
    [setError],
  );

  if (!jsxToRender.trim()) {
    return (
      <div className={cn("p-4 text-sm text-muted-foreground", className)}>
        No JSX content to preview.
      </div>
    );
  }

  return (
    <div className={cn("p-4", className)}>
      <JsxParser
        jsx={jsxToRender}
        components={components as any}
        bindings={bindings}
        renderError={({ error: err }: { error: string }) => {
          handleError(new Error(err));
          return null;
        }}
        renderInWrapper={false}
        allowUnknownElements
        autoCloseVoidElements
      />
    </div>
  );
});

// ---------------------------------------------------------------------------
// JSXPreviewError — conditional error display
// ---------------------------------------------------------------------------

export function JSXPreviewError({
  className,
  children,
}: {
  className?: string;
  children?: (error: Error) => ReactNode;
}) {
  const { error } = useContext(JSXPreviewContext);

  if (!error) return null;

  if (children) {
    return <>{children(error)}</>;
  }

  return (
    <div
      className={cn(
        "flex items-start gap-2 border-t border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive",
        className,
      )}
    >
      <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{error.message}</span>
    </div>
  );
}
