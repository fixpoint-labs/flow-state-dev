/**
 * Parses block input from CLI flags: --input (inline JSON) or --input-file (file path).
 */
import { readFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { CliError } from "./resolve-block";
import { EXIT_INVALID_ARGS } from "./exit-codes";

export interface ParseInputOptions {
  input?: string;
  inputFile?: string;
}

/**
 * Resolves block input from mutually-exclusive CLI flags.
 *
 * @returns The parsed input value, or undefined if neither flag was provided
 * @throws CliError with EXIT_INVALID_ARGS if both flags are provided, JSON is invalid, or file can't be read
 */
export function parseInputArg(options: ParseInputOptions): unknown {
  if (options.input !== undefined && options.inputFile !== undefined) {
    throw new CliError(
      "Cannot specify both --input and --input-file",
      EXIT_INVALID_ARGS,
    );
  }

  if (options.input !== undefined) {
    try {
      return JSON.parse(options.input);
    } catch {
      throw new CliError(
        "Invalid JSON in --input flag",
        EXIT_INVALID_ARGS,
      );
    }
  }

  if (options.inputFile !== undefined) {
    const filePath = isAbsolute(options.inputFile)
      ? options.inputFile
      : resolve(process.cwd(), options.inputFile);

    let raw: string;
    try {
      raw = readFileSync(filePath, "utf-8");
    } catch {
      throw new CliError(
        `Cannot read input file: ${filePath}`,
        EXIT_INVALID_ARGS,
      );
    }

    try {
      return JSON.parse(raw);
    } catch {
      throw new CliError(
        `Invalid JSON in input file: ${filePath}`,
        EXIT_INVALID_ARGS,
      );
    }
  }

  return undefined;
}
