/**
 * Thrown when a generator `outputSchema` — after `makeSchemaStrict` strips its
 * optional/default/nullable wrappers — still contains a construct OpenAI's
 * strict structured-output mode rejects (a reachable `z.record`, or a
 * `z.union` of non-literal variants). Raised eagerly at `generator()`
 * construction so a bad schema fails at definition with a located error,
 * rather than lazily on the first live model call as an opaque
 * `"Invalid schema for response_format"`. See BP-016.
 */
import { FlowError } from "./flow-error";

/** One strict-mode incompatibility, tagged with a JSON-path-ish location. */
export interface StrictViolation {
  /** Location of the offending node, e.g. `$.metrics`, `$.items[]`, `$.result|0`. */
  path: string;
  /** Zod type name that triggered the violation, e.g. `"ZodRecord"`. */
  typeName: string;
  /** Human-readable reason the construct fails strict mode. */
  reason: string;
}

/**
 * Render a violation list into a multi-line message. `label` (e.g. a generator
 * name) prefixes the heading when supplied.
 */
function formatViolations(violations: StrictViolation[], label?: string): string {
  const heading = label
    ? `${label} output schema is not OpenAI strict-mode compatible:`
    : "Output schema is not OpenAI strict-mode compatible:";
  const lines = violations.map((v) => `  ${v.path}: ${v.typeName}: ${v.reason}`);
  return [heading, ...lines].join("\n");
}

export class StrictSchemaError extends FlowError {
  declare readonly details: { violations: StrictViolation[] };

  constructor(violations: StrictViolation[], label?: string) {
    super(formatViolations(violations, label), {
      code: "strict_schema_error",
      retryable: false,
      details: { violations },
    });
    this.name = "StrictSchemaError";
    this.violations = violations;
  }

  /** The strict-mode incompatibilities found, each with its path and reason. */
  readonly violations: StrictViolation[];
}
