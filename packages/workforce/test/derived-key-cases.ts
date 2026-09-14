/**
 * The one table of derived-key cases both doors are graded against.
 *
 * The convention refuses every key it derives at two doors — the reader that
 * parses a file, and the install half that builds a resource from a hand-built
 * record — and the thing actually under test is that the *same set* is refused
 * at both. Two tables spelled separately can drift into agreeing on seven keys
 * and disagreeing on the eighth, which is exactly the bug the two-door shape
 * exists to prevent, so the set is written once and each door supplies its own
 * spelling of the value.
 *
 * Not a test file: no `.test.ts` suffix, so vitest does not collect it.
 */

/** One derived key, in the two forms the two doors take it in. */
export interface DerivedKeyCase {
  /** The key the convention derives, and therefore refuses by name. */
  key: string;
  /** The frontmatter line a document file would declare it with. */
  yaml: string;
  /** The value a hand-built `ResourceDoc` would carry it as. */
  value: unknown;
}

/**
 * Every key in `DERIVED_RESOURCE_KEYS`, with a value that would actually do
 * damage if it were carried verbatim — a redirected storage row, a replaced
 * body, a YAML string where the engine expects a Zod schema.
 *
 * A spec in `resources-from-docs.test.ts` holds this list to exactly
 * `DERIVED_RESOURCE_KEYS`, so a key added to the convention fails there until
 * both doors are graded on it.
 */
export const DERIVED_KEY_CASES: readonly DerivedKeyCase[] = [
  { key: "scope", yaml: "scope: user", value: "user" },
  { key: "ref", yaml: "ref: somewhere-else", value: "somewhere-else" },
  { key: "stateSchema", yaml: "stateSchema: not-a-schema", value: "not-a-schema" },
  { key: "default", yaml: "default: {}", value: {} },
  { key: "content", yaml: "content: hijacked", value: "hijacked" },
  { key: "contentFile", yaml: "contentFile: ./other.md", value: "./other.md" },
  {
    key: "contentTemplate",
    yaml: "contentTemplate: ./other.liquid",
    value: "./other.liquid",
  },
  { key: "contentTemplateRef", yaml: "contentTemplateRef: other", value: "other" },
];
