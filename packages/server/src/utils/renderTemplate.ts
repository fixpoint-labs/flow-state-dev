/**
 * Minimal Mustache-like template renderer for resource content.
 *
 * Supported syntax:
 *   {{field}}            — scalar interpolation (dot-path, `this`, `@index`)
 *   {{#each items}}…{{/each}} — iterate over arrays
 *
 * Limitations:
 *   - Nested `{{#each}}` blocks are not supported. Inner blocks are rendered
 *     as literal text.
 *   - Templates longer than 512 KB are rejected.
 */

const MAX_TEMPLATE_LENGTH = 512_000;

type EachContext = {
  this?: unknown;
  index?: number;
};

function readPath(root: unknown, path: string): unknown {
  if (path.trim() === "this") {
    return root;
  }

  const segments = path.split(".").map((segment) => segment.trim()).filter(Boolean);
  let current: unknown = root;

  for (const segment of segments) {
    if (segment === "this") {
      continue;
    }

    if (typeof current !== "object" || current === null) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function stringifyTemplateValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function renderInline(content: string, state: Record<string, unknown>, each: EachContext): string {
  return content.replace(/{{\s*([@\w.]+)\s*}}/g, (_match, token: string) => {
    const trimmed = token.trim();
    if (trimmed === "this") {
      return stringifyTemplateValue(each.this);
    }

    if (trimmed === "@index") {
      return stringifyTemplateValue(each.index);
    }

    const fromEach = readPath(each.this, trimmed);
    if (fromEach !== undefined) {
      return stringifyTemplateValue(fromEach);
    }

    return stringifyTemplateValue(readPath(state, trimmed));
  });
}

/**
 * Find the index of the `{{/each}}` that closes the `{{#each}}` whose opening
 * tag ends at `startIndex`. Uses nesting-depth counting instead of regex
 * backtracking to guarantee O(n) performance.
 *
 * Returns the index of the opening `{` of the matching `{{/each}}`, or -1 if
 * no matching close tag is found.
 */
function findMatchingEachClose(template: string, startIndex: number): number {
  const openTag = /\{\{#each\s+\S+?\}\}/g;
  const closeTag = /\{\{\/each\}\}/g;
  let depth = 1;
  let pos = startIndex;

  while (depth > 0) {
    openTag.lastIndex = pos;
    closeTag.lastIndex = pos;

    const nextOpen = openTag.exec(template);
    const nextClose = closeTag.exec(template);

    if (nextClose === null) {
      return -1;
    }

    if (nextOpen !== null && nextOpen.index < nextClose.index) {
      depth++;
      pos = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      if (depth === 0) {
        return nextClose.index;
      }
      pos = nextClose.index + nextClose[0].length;
    }
  }

  return -1;
}

function renderEachBody(
  body: string,
  state: Record<string, unknown>,
  target: unknown[]
): string {
  return target
    .map((entry, index) => renderInline(body, state, { this: entry, index }))
    .join("");
}

/**
 * Process all `{{#each …}}…{{/each}}` blocks using forward-only scanning.
 * Unmatched opening tags are left as literal text.
 */
function processEachBlocks(
  content: string,
  state: Record<string, unknown>
): string {
  const openPattern = /\{\{#each\s+([\w.]+)\s*\}\}/g;
  let result = "";
  let lastIndex = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    openPattern.lastIndex = lastIndex;
    const openMatch = openPattern.exec(content);

    if (openMatch === null) {
      break;
    }

    const closeIndex = findMatchingEachClose(
      content,
      openMatch.index + openMatch[0].length
    );

    if (closeIndex === -1) {
      // Unmatched — leave as literal text
      result += content.slice(lastIndex, openMatch.index + openMatch[0].length);
      lastIndex = openMatch.index + openMatch[0].length;
      continue;
    }

    // Append text before the opening tag
    result += content.slice(lastIndex, openMatch.index);

    const targetPath = openMatch[1].trim();
    const body = content.slice(
      openMatch.index + openMatch[0].length,
      closeIndex
    );
    const target = readPath(state, targetPath);

    if (Array.isArray(target) && target.length > 0) {
      result += renderEachBody(body, state, target);
    }

    lastIndex = closeIndex + "{{/each}}".length;
  }

  result += content.slice(lastIndex);
  return result;
}

export function renderTemplate(content: string, state: Record<string, unknown>): string {
  if (content.length > MAX_TEMPLATE_LENGTH) {
    throw new Error(
      `Template exceeds maximum length (${MAX_TEMPLATE_LENGTH} characters)`
    );
  }

  const withEach = processEachBlocks(content, state);
  return renderInline(withEach, state, {});
}
