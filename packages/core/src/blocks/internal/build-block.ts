import type { ZodTypeAny } from "zod";
import type {
  BlockConfig,
  BlockContext,
  BlockDefinition,
  BlockKind,
  ConnectorFn,
  RetryPolicy
} from "../../types/block";

const DEFAULT_RETRY_ATTEMPTS = 1;
const DEFAULT_RETRY_BASE_DELAY_MS = 50;

type ExecuteFn<TInput, TOutput> = (input: TInput, ctx: BlockContext) => Promise<TOutput> | TOutput;

export type BuildBlockOptions<TInput, TOutput> = {
  kind: BlockKind;
  config: BlockConfig<TInput, TOutput>;
  execute?: ExecuteFn<TInput, TOutput>;
};

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    return new Error(value);
  }

  return new Error("Unknown block execution error");
}

function validateSchema<TValue>(
  schema: ZodTypeAny | undefined,
  value: unknown,
  kind: "input" | "output",
  blockName: string
): TValue {
  if (schema === undefined) {
    return value as TValue;
  }

  const result = schema.safeParse(value);
  if (result.success) {
    return result.data as TValue;
  }

  const issue = result.error.issues[0];
  const issuePath = issue === undefined ? "" : issue.path.join(".");
  const issueMessage = issue === undefined ? "schema validation failed" : issue.message;
  const pathSuffix = issuePath.length > 0 ? ` at "${issuePath}"` : "";
  throw new Error(`Block "${blockName}" ${kind} validation failed${pathSuffix}: ${issueMessage}`);
}

function isRetryable(error: Error, retry: RetryPolicy): boolean {
  if (retry.retryableErrors === undefined || retry.retryableErrors.length === 0) {
    return true;
  }

  for (const RetryableError of retry.retryableErrors) {
    if (error instanceof RetryableError) {
      return true;
    }
  }

  return false;
}

async function waitForDelay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) {
    return;
  }

  if (signal?.aborted === true) {
    throw new Error("Block execution aborted");
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error("Block execution aborted"));
    };

    const cleanup = (): void => {
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function runWithRetry<TValue>(
  run: () => Promise<TValue>,
  retry: RetryPolicy | undefined,
  signal: AbortSignal | undefined
): Promise<TValue> {
  if (retry === undefined) {
    return run();
  }

  const maxAttempts = Math.max(DEFAULT_RETRY_ATTEMPTS, retry.maxAttempts ?? DEFAULT_RETRY_ATTEMPTS);
  const baseDelayMs = Math.max(0, retry.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS);
  const maxDelayMs = Math.max(baseDelayMs, retry.maxDelayMs ?? Number.POSITIVE_INFINITY);

  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;

    try {
      return await run();
    } catch (error) {
      const normalizedError = toError(error);
      const shouldRetry = attempt < maxAttempts && isRetryable(normalizedError, retry);

      if (!shouldRetry) {
        throw normalizedError;
      }

      const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
      const delayMs = Math.min(maxDelayMs, exponentialDelay);
      await waitForDelay(delayMs, signal);
    }
  }

  throw new Error("Retry loop exited unexpectedly");
}

function preserveNonFunctionOption<TValue>(value: TValue): TValue | undefined {
  if (typeof value === "function") {
    return undefined;
  }

  return value;
}

export function buildBlock<TInput, TOutput>(options: BuildBlockOptions<TInput, TOutput>): BlockDefinition<TInput, TOutput> {
  const { kind, config } = options;
  const coreExecute = options.execute ?? config.execute;

  if (typeof config.name !== "string" || config.name.trim().length === 0) {
    throw new Error(`Cannot build "${kind}" block without a non-empty "name"`);
  }

  if (coreExecute === undefined) {
    throw new Error(`Cannot build "${config.name}" (${kind}) without an execute function`);
  }

  const runtimeConfig: BlockConfig<TInput, TOutput> = {
    ...config
  };

  const definition: BlockDefinition<TInput, TOutput> = {
    kind,
    name: runtimeConfig.name,
    renderName: runtimeConfig.renderName,
    description: runtimeConfig.description,
    inputSchema: runtimeConfig.inputSchema,
    outputSchema: runtimeConfig.outputSchema,
    config: runtimeConfig,
    connectInput<TFrom>(mapper: ConnectorFn<TFrom, TInput>): BlockDefinition<TFrom, TOutput> {
      const nextConfig = {
        ...(runtimeConfig as unknown as BlockConfig<TFrom, TOutput>),
        connectInput: mapper as unknown as ConnectorFn<unknown, TFrom>
      };

      return buildBlock<TFrom, TOutput>({
        kind,
        config: nextConfig,
        execute: coreExecute as unknown as ExecuteFn<TFrom, TOutput>
      });
    },
    connectOutput<TTo>(
      mapper: (output: TOutput, ctx: BlockContext) => TTo | Promise<TTo>
    ): BlockDefinition<TInput, TTo> {
      const mappedExecute: ExecuteFn<TInput, TTo> = async (input, ctx) => {
        const output = await coreExecute(input, ctx);
        return mapper(output, ctx);
      };

      const nextConfig: BlockConfig<TInput, TTo> = {
        ...(runtimeConfig as unknown as BlockConfig<TInput, TTo>),
        outputSchema: undefined,
        render: preserveNonFunctionOption(runtimeConfig.render) as BlockConfig<TInput, TTo>["render"],
        message: preserveNonFunctionOption(runtimeConfig.message) as BlockConfig<TInput, TTo>["message"],
        onCompleted: undefined
      };

      return buildBlock<TInput, TTo>({
        kind,
        config: nextConfig,
        execute: mappedExecute
      });
    }
  };

  runtimeConfig.execute = async (rawInput: TInput, ctx: BlockContext): Promise<TOutput> => {
    try {
      const connectedInput = runtimeConfig.connectInput
        ? await runtimeConfig.connectInput(rawInput, ctx)
        : rawInput;
      const validatedInput = validateSchema<TInput>(runtimeConfig.inputSchema, connectedInput, "input", runtimeConfig.name);
      const output = await runWithRetry(
        async () => coreExecute(validatedInput, ctx),
        runtimeConfig.retry,
        ctx.signal
      );
      const validatedOutput = validateSchema<TOutput>(
        runtimeConfig.outputSchema,
        output,
        "output",
        runtimeConfig.name
      );

      if (runtimeConfig.onCompleted !== undefined) {
        await runtimeConfig.onCompleted(validatedOutput, ctx);
      }

      return validatedOutput;
    } catch (error) {
      const normalizedError = toError(error);
      if (runtimeConfig.onErrored !== undefined) {
        try {
          await runtimeConfig.onErrored(normalizedError, ctx);
        } catch {
          // Preserve the original block failure and do not mask it with hook errors.
        }
      }

      throw normalizedError;
    }
  };

  return definition;
}
