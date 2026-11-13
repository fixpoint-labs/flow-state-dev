/**
 * Resolves a renderer for a given item type and optional component key.
 *
 * Returns:
 * - `BlockComponentType` — custom renderer to use
 * - `false` — explicitly suppressed (caller should return null)
 * - `undefined` — no renderer registered (fall through to fallback)
 */
export function resolveRenderer(renderers, itemType, componentKey) {
    if (renderers === undefined) {
        return undefined;
    }
    if (itemType === "component" && componentKey !== undefined) {
        return renderers.component?.[componentKey];
    }
    if (itemType === "container" && componentKey !== undefined) {
        return renderers.container?.[componentKey];
    }
    return renderers[itemType];
}
//# sourceMappingURL=block-renderers.js.map