"use client";

/**
 * Live JSX/TSX renderer with streaming support and error fallback.
 *
 * During streaming, unclosed tags are auto-completed so the parser doesn't
 * choke on partial output. While the current input fails to parse, the last
 * successful render stays on screen.
 *
 * The JSX is untrusted (a model wrote it) and renders inside the host's page,
 * so only an allowlist of presentational HTML and SVG tags renders, URL
 * attributes keep only safe schemes, markup-injecting attributes are dropped,
 * and `{...}` expressions that could reach a constructor are refused before
 * anything is evaluated. Components the host passes in `components` are
 * trusted and render as given.
 *
 * Ported from Vercel AI Elements `JSXPreview` component and adapted for
 * the @flow-state-dev/ui registry conventions.
 */

import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Parser as AcornParser } from "acorn";
import acornJsx from "acorn-jsx";
import { AlertTriangleIcon } from "lucide-react";
import {
  createContext,
  createElement,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
// Sanitizing — tag allowlist, URL-scheme allowlist, dropped attributes
// ---------------------------------------------------------------------------

/**
 * The intrinsic tags untrusted JSX may render. Anything else (script, iframe,
 * object, embed, style, link, meta, title, base, form, SVG animation and
 * foreignObject, ...) is not rendered.
 */
const ALLOWED_TAGS = [
  // Text and layout
  "div", "span", "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
  "section", "article", "header", "footer", "main", "nav", "aside",
  "a", "b", "strong", "i", "em", "u", "s", "small", "sub", "sup", "mark",
  "code", "pre", "kbd", "samp", "var", "blockquote", "q", "cite", "abbr",
  "time", "address", "del", "ins", "figure", "figcaption", "details", "summary",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup", "col",
  "img", "progress", "meter",
  // Controls, without a <form> to submit them
  "button", "label", "input", "select", "option", "optgroup", "textarea", "fieldset", "legend",
  // Static SVG
  "svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon", "rect",
  "text", "tspan", "defs", "linearGradient", "radialGradient", "stop",
  "clipPath", "mask", "desc",
] as const;

/** Schemes a URL attribute may carry. A URL with no scheme is relative and kept. */
const ALLOWED_URL_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/** Attributes (lowercased) whose value is a URL the browser loads or navigates to. */
const URL_ATTRIBUTES = new Set([
  "href", "xlinkhref", "xlink:href", "src", "srcset", "action", "formaction", "poster", "cite", "background", "ping",
]);

/**
 * Attributes (lowercased) dropped outright: React's raw-HTML escape hatch,
 * a document-in-an-attribute, and `form`, which would attach a control to a
 * form elsewhere on the host page.
 */
const DROPPED_ATTRIBUTES = new Set(["dangerouslysetinnerhtml", "srcdoc", "form"]);

/** True when a URL is relative or uses an allowed scheme. */
function isSafeUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  // Browsers ignore ASCII whitespace and control characters inside a scheme
  // ("java\tscript:"), so strip them before reading it.
  const normalized = value.replace(/[\u0000-\u0020\u007f]/g, "");
  const scheme = /^([a-z][a-z0-9+.-]*:)/i.exec(normalized)?.[1];
  return scheme === undefined || ALLOWED_URL_SCHEMES.has(scheme.toLowerCase());
}

/** The props an untrusted intrinsic element keeps. */
function sanitizeProps(props: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(props)) {
    const lower = name.toLowerCase();
    if (lower.startsWith("on") || DROPPED_ATTRIBUTES.has(lower)) continue;
    if (URL_ATTRIBUTES.has(lower) && !isSafeUrl(value)) continue;
    safe[name] = value;
  }
  return safe;
}

/**
 * One component per allowed tag that renders the tag with sanitized props.
 * Rendered under `componentsOnly`, so a tag missing from this map (and from
 * the host's components) is not rendered at all.
 */
const SAFE_INTRINSICS: Record<string, ComponentType<any>> = Object.fromEntries(
  ALLOWED_TAGS.map((tag) => {
    const Safe = (props: Record<string, unknown>) => createElement(tag, sanitizeProps(props));
    Safe.displayName = tag;
    return [tag, Safe];
  }),
);

// ---------------------------------------------------------------------------
// Expression check — no route from a literal to the Function constructor
// ---------------------------------------------------------------------------

/**
 * Property names that walk from a value to its prototype or constructor.
 * The parser evaluates `{...}` expressions, so `"".constructor.constructor`
 * reaches `Function` and `Function("code")()` runs arbitrary script. No
 * globals are in scope, so blocking these names (and property keys computed
 * at runtime, which could spell them) closes that route.
 */
const DENIED_NAMES = new Set([
  "constructor", "prototype", "__proto__",
  "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__",
]);

/** The void tags the parser self-closes under `autoCloseVoidElements`; mirrored so both parse alike. */
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "keygen",
  "link", "menuitem", "meta", "param", "source", "track", "wbr",
]);

const ExpressionCheckParser = AcornParser.extend(
  acornJsx(),
  (Base) =>
    class extends (Base as any) {
      jsx_parseOpeningElementAt(...args: unknown[]) {
        const node = super.jsx_parseOpeningElementAt(...args);
        if (node.name?.type === "JSXIdentifier" && VOID_TAGS.has(node.name.name)) node.selfClosing = true;
        return node;
      }
    } as unknown as typeof AcornParser,
);

/** The first thing in `node`'s tree that could reach a constructor, or null. */
function findDeniedAccess(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findDeniedAccess(child);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, any>;
  switch (n.type) {
    case "MemberExpression":
      if (n.computed) {
        const key = n.property;
        if (key.type !== "Literal" || typeof key.value === "object") return "a property key computed at runtime";
        if (DENIED_NAMES.has(String(key.value))) return `the property "${key.value}"`;
      } else if (DENIED_NAMES.has(n.property.name)) {
        return `the property "${n.property.name}"`;
      }
      break;
    case "JSXMemberExpression":
    case "Identifier":
    case "JSXIdentifier": {
      const name = n.type === "JSXMemberExpression" ? n.property.name : n.name;
      if (DENIED_NAMES.has(name)) return `the name "${name}"`;
      break;
    }
    case "Property": {
      const key = n.computed ? null : (n.key.name ?? n.key.value);
      if (n.computed || DENIED_NAMES.has(String(key))) return "that object key";
      break;
    }
  }
  for (const [field, child] of Object.entries(n)) {
    if (field === "loc" || field === "start" || field === "end") continue;
    const found = findDeniedAccess(child);
    if (found) return found;
  }
  return null;
}

/**
 * Parse `jsx` the way the renderer will and reject it if any expression could
 * reach a constructor. Fails closed: input this parser cannot read is not
 * rendered, so the renderer never evaluates an expression unchecked.
 */
function checkExpressions(jsx: string): Error | null {
  try {
    const ast = ExpressionCheckParser.parse(`<root>${jsx}</root>`, { ecmaVersion: "latest" });
    const denied = findDeniedAccess(ast);
    return denied ? new Error(`The JSX uses ${denied}, which is not allowed in a preview.`) : null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

// ---------------------------------------------------------------------------
// Parsing — a pure function of the input
// ---------------------------------------------------------------------------

interface ParseResult {
  nodes: ReactNode;
  error: Error | null;
}

/**
 * Parse and render `jsx` to React nodes, synchronously.
 *
 * Runs the parser's own `render()` outside a React render so the result and
 * any parse error can be derived with `useMemo`. The parser reports errors
 * through callbacks invoked while it renders; turning those into state from
 * inside its render is a state update during another component's render.
 */
function parseJsx(
  jsx: string,
  components: Record<string, ComponentType<any>>,
  bindings: Record<string, unknown>,
): ParseResult {
  // The parser renders this exact string; check the same one.
  const source = jsx.trim().replace(/<!DOCTYPE([^>]*)>/g, "");
  const denied = checkExpressions(source);
  if (denied) return { nodes: null, error: denied };

  let error: Error | null = null;
  const parser = new JsxParser({
    ...JsxParser.defaultProps,
    jsx: source,
    // Host components win over the allowlist: the host chose them. No
    // prototype, so a tag named `constructor` or `toString` resolves to nothing.
    components: Object.assign(Object.create(null), SAFE_INTRINSICS, components),
    bindings,
    componentsOnly: true,
    renderInWrapper: false,
    autoCloseVoidElements: true,
    renderError: ({ error: message }: { error: string }) => {
      error = new Error(message);
      return null;
    },
  });
  const nodes = parser.render() as ReactNode;
  return { nodes: error ? null : nodes, error };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface JSXPreviewContextType {
  /** What to show: the current render, or the last good one while the input fails to parse. */
  nodes: ReactNode;
  /** True when there is no JSX to render. */
  isEmpty: boolean;
  error: Error | null;
}

const JSXPreviewContext = createContext<JSXPreviewContextType>({
  nodes: null,
  isEmpty: true,
  error: null,
});

// ---------------------------------------------------------------------------
// JSXPreview — root provider
// ---------------------------------------------------------------------------

export interface JSXPreviewProps {
  /** Raw JSX/TSX string to render. */
  jsx: string;
  /** Whether JSX is still being streamed (enables tag auto-completion). */
  isStreaming?: boolean;
  /** Map of component names available inside the JSX. Trusted: rendered as given. */
  components?: Record<string, ComponentType<any>>;
  /** Map of variable bindings available inside the JSX. */
  bindings?: Record<string, unknown>;
  /** Called when a render error occurs. */
  onError?: (error: Error) => void;
  children?: ReactNode;
  className?: string;
}

const NO_COMPONENTS: Record<string, ComponentType<any>> = {};
const NO_BINDINGS: Record<string, unknown> = {};

export function JSXPreview({
  jsx,
  isStreaming = false,
  components = NO_COMPONENTS,
  bindings = NO_BINDINGS,
  onError,
  children,
  className,
}: JSXPreviewProps) {
  const completedJsx = useMemo(
    () => (isStreaming ? completeJsxTag(jsx) : jsx),
    [jsx, isStreaming],
  );
  const isEmpty = !completedJsx.trim();

  const result = useMemo<ParseResult>(
    () => (isEmpty ? { nodes: null, error: null } : parseJsx(completedJsx, components, bindings)),
    [isEmpty, completedJsx, components, bindings],
  );

  // Remembers the last committed render that parsed, to show while a later
  // input fails. History, not derivable from the current props, so it is
  // written after commit rather than during render.
  const lastGoodRef = useRef<ReactNode>(null);
  useEffect(() => {
    if (!result.error) lastGoodRef.current = result.nodes;
  }, [result]);

  // Notifies the host of a new parse error: a call out of the component, so
  // it runs after commit, once per distinct error.
  useEffect(() => {
    if (result.error) onError?.(result.error);
  }, [result.error, onError]);

  const nodes = result.error ? lastGoodRef.current : result.nodes;

  const ctx = useMemo(
    () => ({ nodes, isEmpty, error: result.error }),
    [nodes, isEmpty, result.error],
  );

  return (
    <JSXPreviewContext.Provider value={ctx}>
      <div className={cn("relative", className)}>{children}</div>
    </JSXPreviewContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// JSXPreviewContent — renders the parsed nodes
// ---------------------------------------------------------------------------

export const JSXPreviewContent = memo(function JSXPreviewContent({
  className,
}: {
  className?: string;
}) {
  const { nodes, isEmpty } = useContext(JSXPreviewContext);

  if (isEmpty) {
    return (
      <div className={cn("p-4 text-sm text-muted-foreground", className)}>
        No JSX content to preview.
      </div>
    );
  }

  return <div className={cn("p-4", className)}>{nodes}</div>;
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
