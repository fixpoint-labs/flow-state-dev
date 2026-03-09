import { readFile } from "node:fs/promises";
import type { ZodTypeAny } from "zod";
import type { EvalCase, CsvMapping, LoadDatasetOptions } from "./types";

// ---------------------------------------------------------------------------
// loadDataset — JSON files
// ---------------------------------------------------------------------------

export async function loadDataset<
  TInput = unknown,
  TExpected = unknown,
>(
  path: string,
  options?: LoadDatasetOptions<EvalCase<TInput, TExpected>>,
): Promise<EvalCase<TInput, TExpected>[]> {
  const raw = await readFile(path, "utf-8");
  const parsed: unknown = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`Dataset file must contain a JSON array, got ${typeof parsed}`);
  }

  const cases: EvalCase<TInput, TExpected>[] = [];
  for (let i = 0; i < parsed.length; i++) {
    let entry = parsed[i] as EvalCase<TInput, TExpected>;

    if (options?.schema) {
      const result = (options.schema as ZodTypeAny).safeParse(entry);
      if (!result.success) {
        const issues = result.error.issues
          .map(
            (issue: { path: (string | number)[]; message: string }) =>
              `${issue.path.join(".")}: ${issue.message}`,
          )
          .join("; ");
        throw new Error(`Dataset case ${i}: validation failed — ${issues}`);
      }
      entry = result.data as EvalCase<TInput, TExpected>;
    }

    if (options?.transform) {
      entry = options.transform(entry as unknown) as EvalCase<TInput, TExpected>;
    }

    if (!entry.id) {
      entry = { ...entry, id: `case-${i}` };
    }

    cases.push(entry);
  }

  return cases;
}

// ---------------------------------------------------------------------------
// fromCsv — CSV files
// ---------------------------------------------------------------------------

function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }

  fields.push(current);
  return fields;
}

export async function fromCsv<TInput = unknown, TExpected = unknown>(
  path: string,
  mapping: CsvMapping<TInput, TExpected>,
): Promise<EvalCase<TInput, TExpected>[]> {
  const raw = await readFile(path, "utf-8");
  const lines = raw.replace(/\r\n/g, "\n").split("\n").filter((line: string) => line.length > 0);

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvRow(lines[0]!);
  const cases: EvalCase<TInput, TExpected>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvRow(lines[i]!);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = values[j] ?? "";
    }

    const evalCase: EvalCase<TInput, TExpected> = {
      id: mapping.id ? mapping.id(row) : `case-${i - 1}`,
      input: mapping.input(row),
      expected: mapping.expected ? mapping.expected(row) : undefined,
    };

    cases.push(evalCase);
  }

  return cases;
}
