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

export function renderTemplate(content: string, state: Record<string, unknown>): string {
  const eachPattern = /{{#each\s+([\w.]+)\s*}}([\s\S]*?){{\/each}}/g;

  const withEach = content.replace(eachPattern, (_match, targetPath: string, blockBody: string) => {
    const target = readPath(state, targetPath.trim());
    if (!Array.isArray(target) || target.length === 0) {
      return "";
    }

    return target
      .map((entry, index) => renderInline(blockBody, state, { this: entry, index }))
      .join("");
  });

  return renderInline(withEach, state, {});
}
