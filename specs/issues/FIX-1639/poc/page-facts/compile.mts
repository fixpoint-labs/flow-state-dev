/**
 * FIX-1639 · poc/page-facts/compile.mts — retained as evidence. A one-time pre-merge check,
 * like names.mts: the implementer runs it once, on the final page, in the implementation PR.
 *
 * Every TypeScript fence on the page compiles, strict, against the packages' own source.
 * names.mts proves each name exists; this proves the samples fit together (a flow the host
 * can register, options the builders accept). It is what catches `flows: { billing }` with an
 * uninstantiated flow, or a `defineFlow` with no `actions`.
 *
 * The page leaves three names to the reader (`recordPayment`, `generateMonthlyInvoices`,
 * `StripeEvent`); a fixed preamble declares them. An elided `{ /* ... *\/ }` compiles as
 * `{} as never`. Nothing else is added.
 *
 * Fences are written to a temp dir by their `title=` (a second fence with a title already
 * used gets a suffix); an untitled fence gets its own file.
 *
 * Control, must FAIL:
 *   CONTROL=unminted   the host registers `flows: { billing }` (the flow type, not an instance)
 *
 * Run from the repo root:  pnpm exec tsx specs/issues/FIX-1639/poc/page-facts/compile.mts
 * After publishing:         PAGE=apps/docs/guides/keeping-a-flow-running.md pnpm exec tsx …
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../../..");
const CONTROL = process.env.CONTROL ?? "";
const PAGE = process.env.PAGE;

const lines = PAGE
  ? readFileSync(resolve(ROOT, PAGE), "utf8").split("\n")
  : readFileSync(join(HERE, "../../DOCS.md"), "utf8")
      .split("\n")
      .filter((l) => l.startsWith(">"))
      .map((l) => l.replace(/^> ?/, ""));

const fences: { title: string | undefined; code: string }[] = [];
{
  let open: { title: string | undefined; body: string[] } | null = null;
  for (const line of lines) {
    const fence = /^\s*```(\w*)(.*)$/.exec(line);
    if (fence) {
      if (open === null) {
        if (fence[1] === "ts" || fence[1] === "typescript") {
          open = { title: /title="([^"]+)"/.exec(fence[2] ?? "")?.[1], body: [] };
        } else {
          open = { title: "__skip__", body: [] };
        }
      } else {
        if (open.title !== "__skip__") fences.push({ title: open.title, code: open.body.join("\n") });
        open = null;
      }
      continue;
    }
    open?.body.push(line);
  }
}

const PREAMBLE = `
import { handler as __handler } from "@flow-state-dev/core";
import { z as __z } from "zod";
type StripeEvent = { type: string; data: { object: { id: string; customer: string } } };
const recordPayment = __handler({ name: "record-payment", inputSchema: __z.object({ invoiceId: __z.string() }),
  outputSchema: __z.object({}), execute: async () => ({}) });
const generateMonthlyInvoices = __handler({ name: "generate-monthly-invoices", inputSchema: __z.unknown(),
  outputSchema: __z.object({}), execute: async () => ({}) });
void recordPayment; void generateMonthlyInvoices;
`;

const dir = mkdtempSync(join(tmpdir(), "fix1639-compile-"));
const files: string[] = [];
const used = new Set<string>();
fences.forEach((f, i) => {
  let name = f.title ?? `fence-${i}.ts`;
  if (used.has(name)) name = name.replace(/\.ts$/, `-${i}.ts`);
  used.add(name);
  let code = f.code.replace(/\{\s*\/\*\s*\.\.\.\s*\*\/\s*\}/g, "{} as never");
  if (CONTROL === "unminted") code = code.replace("flows: { billing: billing() }", "flows: { billing }");
  const path = join(dir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${PREAMBLE}\n${code}\nexport {};\n`);
  files.push(path);
});

const program = ts.createProgram(files, {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true,
  noEmit: true, skipLibCheck: true, strict: true, jsx: ts.JsxEmit.ReactJSX,
  types: ["node"], typeRoots: [join(ROOT, "node_modules/@types"), join(ROOT, "packages/engine/node_modules/@types")],
  baseUrl: ROOT,
  paths: {
    "@flow-state-dev/core": ["packages/core/src/index.ts"],
    "@flow-state-dev/engine": ["packages/engine/src/index.ts"],
    "@flow-state-dev/scheduled": ["packages/scheduled/src/index.ts"],
    "@flow-state-dev/bullmq": ["packages/bullmq/src/index.ts"],
    zod: ["packages/core/node_modules/zod"]
  }
});
// Only the page's own files count: the packages are checked by their own typecheck.
const diags = ts.getPreEmitDiagnostics(program).filter((d) => d.file !== undefined && files.includes(d.file.fileName));

console.log(CONTROL ? `CONTROL=${CONTROL} (must FAIL)` : "page code fences compile");
console.log(`fences=${files.length} errors=${diags.length}`);
for (const d of diags) {
  const { line } = d.file!.getLineAndCharacterOfPosition(d.start ?? 0);
  const rel = d.file!.fileName.slice(dir.length + 1);
  console.log(`FAIL  ${rel}:${line + 1 - PREAMBLE.split("\n").length}  ${ts.flattenDiagnosticMessageText(d.messageText, " ").slice(0, 160)}`);
}
process.exit(diags.length === 0 ? 0 : 1);
