import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { loadDataset, fromCsv } from "../src/eval/dataset";

const TMP_DIR = join(process.cwd(), ".test-eval-dataset-tmp");

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("loadDataset", () => {
  it("loads a JSON array file", async () => {
    const file = join(TMP_DIR, "basic.json");
    writeFileSync(
      file,
      JSON.stringify([
        { input: { prompt: "hello" }, expected: { reply: "hi" } },
        { input: { prompt: "bye" } },
      ]),
    );

    const cases = await loadDataset(file);
    expect(cases).toHaveLength(2);
    expect(cases[0].id).toBe("case-0");
    expect(cases[0].input).toEqual({ prompt: "hello" });
    expect(cases[1].expected).toBeUndefined();
  });

  it("preserves existing IDs", async () => {
    const file = join(TMP_DIR, "with-ids.json");
    writeFileSync(
      file,
      JSON.stringify([{ id: "my-case", input: "data" }]),
    );

    const cases = await loadDataset(file);
    expect(cases[0].id).toBe("my-case");
  });

  it("validates with Zod schema", async () => {
    const file = join(TMP_DIR, "validated.json");
    writeFileSync(
      file,
      JSON.stringify([{ input: "valid", expected: "result" }]),
    );

    const schema = z.object({
      input: z.string(),
      expected: z.string(),
    });

    const cases = await loadDataset(file, { schema });
    expect(cases).toHaveLength(1);
  });

  it("throws on Zod validation failure", async () => {
    const file = join(TMP_DIR, "invalid.json");
    writeFileSync(file, JSON.stringify([{ input: 123 }]));

    const schema = z.object({ input: z.string() });
    await expect(loadDataset(file, { schema })).rejects.toThrow(
      "validation failed",
    );
  });

  it("throws on non-array JSON", async () => {
    const file = join(TMP_DIR, "object.json");
    writeFileSync(file, JSON.stringify({ not: "array" }));

    await expect(loadDataset(file)).rejects.toThrow("JSON array");
  });
});

describe("fromCsv", () => {
  it("parses a simple CSV", async () => {
    const file = join(TMP_DIR, "simple.csv");
    writeFileSync(file, "prompt,expected\nhello,hi\nbye,goodbye\n");

    const cases = await fromCsv(file, {
      input: (row) => ({ prompt: row.prompt }),
      expected: (row) => ({ reply: row.expected }),
    });

    expect(cases).toHaveLength(2);
    expect(cases[0].id).toBe("case-0");
    expect(cases[0].input).toEqual({ prompt: "hello" });
    expect(cases[0].expected).toEqual({ reply: "hi" });
  });

  it("handles quoted fields with commas", async () => {
    const file = join(TMP_DIR, "quoted.csv");
    writeFileSync(
      file,
      'name,value\n"Smith, John","hello, world"\n',
    );

    const cases = await fromCsv(file, {
      input: (row) => ({ name: row.name, value: row.value }),
    });

    expect(cases[0].input).toEqual({
      name: "Smith, John",
      value: "hello, world",
    });
  });

  it("handles escaped quotes", async () => {
    const file = join(TMP_DIR, "escaped.csv");
    writeFileSync(file, 'text\n"He said ""hi"""\n');

    const cases = await fromCsv(file, {
      input: (row) => row.text,
    });

    expect(cases[0].input).toBe('He said "hi"');
  });

  it("uses custom id mapping", async () => {
    const file = join(TMP_DIR, "custom-id.csv");
    writeFileSync(file, "id,prompt\nabc,hello\n");

    const cases = await fromCsv(file, {
      input: (row) => row.prompt,
      id: (row) => row.id!,
    });

    expect(cases[0].id).toBe("abc");
  });

  it("returns empty for header-only CSV", async () => {
    const file = join(TMP_DIR, "empty.csv");
    writeFileSync(file, "a,b\n");

    const cases = await fromCsv(file, {
      input: (row) => row,
    });

    expect(cases).toHaveLength(0);
  });
});
