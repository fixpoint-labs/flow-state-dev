/**
 * Test fixture: a module that imports fine but is not a flow (no default
 * FlowInstance export). The candidate loop must fall through past it to
 * index.ts — the barrel-style layout this preserves exists in real apps.
 */
export const helper = (value: string): string => `helper: ${value}`;
