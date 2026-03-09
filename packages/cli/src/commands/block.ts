/**
 * `fsdev block <specifier>` command — executes a single block in isolation.
 */
import type { Command } from "commander";
import type { BlockKind } from "@flow-state-dev/core/types";
import { createTestContext } from "@flow-state-dev/testing";
import { resolveBlock, CliError } from "../resolve-block.js";
import { parseInputArg } from "../parse-input.js";
import { formatOutput } from "../format-output.js";
import { EXIT_SUCCESS, EXIT_EXECUTION_ERROR, EXIT_INVALID_ARGS } from "../exit-codes.js";

/** Structured output shape for `fsdev block`. */
export interface BlockExecResult {
  success: boolean;
  block: {
    kind: BlockKind;
    name: string;
  };
  output: unknown;
  schemaValidation: {
    input: { passed: boolean; errors?: string[] };
    output: { passed: boolean; errors?: string[] };
  };
  execution: {
    durationMs: number;
  };
  error?: {
    message: string;
    stack?: string;
  };
}

function validateWithSchema(
  schema: { safeParse: (value: unknown) => { success: boolean; error?: { issues: { message: string }[] } } } | undefined,
  value: unknown,
): { passed: boolean; errors?: string[] } {
  if (schema === undefined) {
    return { passed: true };
  }

  const result = schema.safeParse(value);
  if (result.success) {
    return { passed: true };
  }

  return {
    passed: false,
    errors: result.error?.issues.map((i) => i.message) ?? ["Validation failed"],
  };
}

/** Registers the `block` subcommand on the given commander program. */
export function registerBlockCommand(program: Command): void {
  program
    .command("block <specifier>")
    .description("Execute a single block in isolation")
    .option("-i, --input <json>", "Inline JSON input")
    .option("-f, --input-file <path>", "Path to JSON input file")
    .option("-m, --model <model>", "Model override for generator blocks")
    .option("--format <format>", "Output format", "json")
    .action(async (specifier: string, options: {
      input?: string;
      inputFile?: string;
      model?: string;
      format?: string;
    }) => {
      try {
        await executeBlockCommand(specifier, options);
      } catch (err) {
        if (err instanceof CliError) {
          process.stderr.write(err.message + "\n");
          process.exitCode = err.exitCode;
          return;
        }
        process.stderr.write(
          `Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exitCode = EXIT_EXECUTION_ERROR;
      }
    });
}

/** Core execution logic for `fsdev block`, separated for testability. */
export async function executeBlockCommand(
  specifier: string,
  options: {
    input?: string;
    inputFile?: string;
    model?: string;
    format?: string;
  },
): Promise<BlockExecResult> {
  const block = await resolveBlock(specifier);
  const input = parseInputArg({ input: options.input, inputFile: options.inputFile });

  // Validate input against block's schema (non-aborting)
  const inputValidation = validateWithSchema(block.inputSchema, input);

  // Build execution context
  const testContextOptions: Record<string, unknown> = {
    userId: "cli-user",
  };

  // Model override: use passthrough policy so unmocked generators call real providers
  if (options.model !== undefined) {
    (testContextOptions as any).models = { "*": options.model };
    (testContextOptions as any).unmockedGeneratorPolicy = "passthrough";
  }

  const { ctx } = await createTestContext(testContextOptions);

  // Execute block
  const startMs = Date.now();
  let output: unknown;
  let error: { message: string; stack?: string } | undefined;
  let success = true;

  try {
    output = await block.run(input, ctx);
  } catch (err) {
    success = false;
    error = {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    };
  }

  const durationMs = Date.now() - startMs;

  // Validate output against block's schema (non-aborting)
  const outputValidation = success
    ? validateWithSchema(block.outputSchema, output)
    : { passed: true };

  const result: BlockExecResult = {
    success,
    block: {
      kind: block.kind,
      name: block.name,
    },
    output: output ?? null,
    schemaValidation: {
      input: inputValidation,
      output: outputValidation,
    },
    execution: {
      durationMs,
    },
    ...(error !== undefined ? { error } : {}),
  };

  const format = (options.format ?? "json") as "json";
  process.stdout.write(formatOutput(result, format) + "\n");
  process.exitCode = success ? EXIT_SUCCESS : EXIT_EXECUTION_ERROR;

  return result;
}
