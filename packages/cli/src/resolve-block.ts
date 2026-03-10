/**
 * Resolves a file-path specifier to a validated BlockDefinition.
 * Used by `fsdev block` and future commands to load blocks from the filesystem.
 */
import { resolve, isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import type { BlockDefinition, BlockKind } from "@flow-state-dev/core/types";
import { EXIT_INVALID_ARGS } from "./exit-codes.js";

const VALID_BLOCK_KINDS: ReadonlySet<string> = new Set<BlockKind>([
  "handler",
  "generator",
  "sequencer",
  "router",
]);

/**
 * Structural check for a BlockDefinition. We don't use instanceof because blocks
 * are created by factory functions across packages.
 */
export function isBlockDefinition(value: unknown): value is BlockDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "name" in value &&
    "run" in value &&
    typeof (value as any).run === "function" &&
    VALID_BLOCK_KINDS.has((value as any).kind)
  );
}

export class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = "CliError";
  }
}

/**
 * Loads a block from a file path specifier and validates its shape.
 *
 * @param specifier - File path (absolute or relative to cwd) to a module with a default-exported BlockDefinition
 * @returns The validated BlockDefinition
 * @throws CliError with EXIT_INVALID_ARGS if the file doesn't exist, has no default export, or the export isn't a BlockDefinition
 */
export async function resolveBlock(specifier: string): Promise<BlockDefinition> {
  const filePath = isAbsolute(specifier) ? specifier : resolve(process.cwd(), specifier);

  if (!existsSync(filePath)) {
    throw new CliError(`Block file not found: ${filePath}`, EXIT_INVALID_ARGS);
  }

  let mod: Record<string, unknown>;
  try {
    mod = await import(filePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError(`Failed to import block file: ${message}`, EXIT_INVALID_ARGS);
  }

  const block = mod.default;
  if (block === undefined) {
    throw new CliError(
      `Block file has no default export: ${filePath}`,
      EXIT_INVALID_ARGS,
    );
  }

  if (!isBlockDefinition(block)) {
    throw new CliError(
      `Default export is not a valid BlockDefinition (must have kind, name, and run): ${filePath}`,
      EXIT_INVALID_ARGS,
    );
  }

  return block;
}
