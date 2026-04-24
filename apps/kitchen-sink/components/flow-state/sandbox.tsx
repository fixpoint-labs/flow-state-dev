"use client";

/**
 * Source/preview tab wrapper for JSX artifacts.
 *
 * Pairs `JSXPreview` with `CodeBlock` in a tab interface so users can
 * toggle between a live rendered preview and the syntax-highlighted source.
 *
 * Depends on the `jsx-preview`, `code-block`, and `tabs` registry components.
 */

import type { ComponentType, HTMLAttributes } from "react";

import { cn } from "@/lib/utils";
import { useState } from "react";

import {
  CodeBlock,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockActions,
} from "./code-block";
import {
  JSXPreview,
  JSXPreviewContent,
  JSXPreviewError,
} from "./jsx-preview";

// ---------------------------------------------------------------------------
// Sandbox — tab container with Preview and Source tabs
// ---------------------------------------------------------------------------

export interface SandboxProps extends HTMLAttributes<HTMLDivElement> {
  /** Raw JSX/TSX string. */
  jsx: string;
  /** Whether content is still streaming. */
  isStreaming?: boolean;
  /** Components available inside the JSX preview. */
  components?: Record<string, ComponentType<any>>;
  /** Variable bindings available inside the JSX preview. */
  bindings?: Record<string, unknown>;
}

export function Sandbox({
  jsx,
  isStreaming = false,
  components,
  bindings,
  className,
  ...props
}: SandboxProps) {
  const [tab, setTab] = useState<"preview" | "source">("preview");

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-md border bg-background",
        className,
      )}
      {...props}
    >
      {/* Tab header */}
      <div className="flex items-center border-b bg-muted/80 px-1">
        <TabButton
          active={tab === "preview"}
          onClick={() => setTab("preview")}
        >
          Preview
        </TabButton>
        <TabButton
          active={tab === "source"}
          onClick={() => setTab("source")}
        >
          Source
        </TabButton>
      </div>

      {/* Tab content */}
      {tab === "preview" ? (
        <JSXPreview
          jsx={jsx}
          isStreaming={isStreaming}
          components={components}
          bindings={bindings}
        >
          <JSXPreviewContent className="min-h-[100px]" />
          <JSXPreviewError />
        </JSXPreview>
      ) : (
        <CodeBlock code={jsx} language="tsx">
          <CodeBlockHeader>
            <span className="font-mono text-xs text-muted-foreground">tsx</span>
            <CodeBlockActions>
              <CodeBlockCopyButton />
            </CodeBlockActions>
          </CodeBlockHeader>
        </CodeBlock>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal tab button
// ---------------------------------------------------------------------------

function TabButton({
  active,
  className,
  ...props
}: HTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-b-2 border-foreground text-foreground"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
