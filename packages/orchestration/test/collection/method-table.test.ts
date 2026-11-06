/**
 * The task collection's methods are written in one place, the method table.
 *
 * The two backings (`state-backed.ts`, `resource-backed.ts`) each used to
 * define every `TaskCollectionRef` method over their own storage, and a rule
 * added to how a task write behaves had to be written twice and kept in step
 * by hand. The parity tests (`describe.each(BACKINGS)`) hold what the methods
 * do; this test holds where they are written: each backing supplies storage,
 * and `method-table.ts` defines every method once.
 *
 * Read off the source with the TypeScript parser, so a method kept in a
 * backing under any key form counts, and checked at runtime too, so a method
 * a backing defines under a renamed local and then attaches still counts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { TaskCollectionRef } from "../../src/tasks";
import { createResourceBackedTaskCollection } from "../../src/tasks/collection/resource-backed";
import { createStateBackedTaskCollection } from "../../src/tasks/collection/state-backed";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const collectionDir = path.resolve(here, "../../src/tasks/collection");
const BACKING_FILES = ["state-backed.ts", "resource-backed.ts"] as const;
const TABLE_FILE = "method-table.ts";

function parse(file: string): ts.SourceFile {
  const full = path.join(collectionDir, file);
  return ts.createSourceFile(full, readFileSync(full, "utf8"), ts.ScriptTarget.Latest, true);
}

/** The methods `TaskCollectionRef` declares, read off its interface. */
function refMethodNames(): string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === "TaskCollectionRef") {
      for (const member of node.members) {
        if (ts.isMethodSignature(member) && member.name !== undefined) names.push(member.name.getText());
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parse("types.ts"));
  return names;
}

/** A member name as written: `name`, `"name"` or `["name"]`. */
function memberName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
  return undefined;
}

/**
 * Every name `file` defines as an object member, or assigns onto an object
 * (`x.name = …`, `x["name"] = …`), with how often.
 */
function definedMembers(file: string): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (name: string | undefined): void => {
    if (name !== undefined) counts.set(name, (counts.get(name) ?? 0) + 1);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop) || ts.isMethodDeclaration(prop) || ts.isGetAccessor(prop)) add(memberName(prop.name));
        else if (ts.isShorthandPropertyAssignment(prop)) add(prop.name.text);
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const target = node.left;
      if (ts.isPropertyAccessExpression(target)) add(target.name.text);
      else if (ts.isElementAccessExpression(target) && ts.isStringLiteralLike(target.argumentExpression)) {
        add(target.argumentExpression.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return counts;
}

/**
 * The members of each object literal `file` declares as a `TaskCollectionRef`
 * (`const ref: TaskCollectionRef<…> = { … }`), with how often each is
 * defined, counting the literals a conditional spread adds.
 */
function refLiterals(file: string): Map<string, number>[] {
  const literals: Map<string, number>[] = [];
  const membersOf = (literal: ts.ObjectLiteralExpression, counts: Map<string, number>): void => {
    for (const prop of literal.properties) {
      if (ts.isSpreadAssignment(prop)) {
        spread(prop.expression, counts);
        continue;
      }
      const name = ts.isShorthandPropertyAssignment(prop) ? prop.name.text : prop.name ? memberName(prop.name) : undefined;
      if (name !== undefined) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  };
  const spread = (expr: ts.Expression, counts: Map<string, number>): void => {
    if (ts.isParenthesizedExpression(expr)) spread(expr.expression, counts);
    else if (ts.isConditionalExpression(expr)) {
      spread(expr.whenTrue, counts);
      spread(expr.whenFalse, counts);
    } else if (ts.isBinaryExpression(expr)) spread(expr.right, counts);
    else if (ts.isObjectLiteralExpression(expr)) membersOf(expr, counts);
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.type !== undefined &&
      /^TaskCollectionRef\b/.test(node.type.getText()) &&
      node.initializer !== undefined &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const counts = new Map<string, number>();
      membersOf(node.initializer, counts);
      literals.push(counts);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return literals;
}

/** One ref from each backing, the resource one with a delivery so its optional members are present. */
async function refsFromBothBackings(): Promise<[string, TaskCollectionRef][]> {
  const state = createStateBackedTaskCollection({
    collectionId: "tasks",
    state: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
  });
  const resource = await createResourceBackedTaskCollection({
    collectionId: "tasks",
    collection: createFakeResourceCollection(),
    delivery: {
      ownSession: "s",
      hooks: {
        filerOf: () => "s",
        beforeEnding: async () => {},
        afterEnding: async () => {},
        owePassAt: async () => {},
        tellMidwayQuestions: async () => {},
      } as never,
    },
  });
  return [
    ["state-backed", state],
    ["resource-backed", resource],
  ];
}

describe("the task collection's methods are written once, in the method table", () => {
  const methods = refMethodNames();

  it("reads the methods off TaskCollectionRef", () => {
    // A parser that found nothing would pass every check below for free.
    expect(methods.length).toBeGreaterThanOrEqual(38);
    expect(methods).toEqual(expect.arrayContaining(["createTask", "claim", "fail", "patchSettings", "count"]));
  });

  it.each(BACKING_FILES)("%s defines none of them", (file) => {
    const defined = definedMembers(file);
    expect(methods.filter((name) => defined.has(name))).toEqual([]);
  });

  it("the method table defines each of them exactly once, on its one ref", () => {
    const literals = refLiterals(TABLE_FILE);
    expect(literals).toHaveLength(1);
    const defined = literals[0]!;
    const notOnce = methods.filter((name) => defined.get(name) !== 1).map((name) => `${name} × ${defined.get(name) ?? 0}`);
    expect(notOnce).toEqual([]);
  });

  it("both backings hand out the same functions, method for method", async () => {
    // A method a backing wrote under a renamed local and attached would read
    // as that backing's own code here, not the table's.
    const [[, state], [, resource]] = await refsFromBothBackings();
    const differ: string[] = [];
    for (const name of methods) {
      const a = (state as unknown as Record<string, unknown>)[name];
      const b = (resource as unknown as Record<string, unknown>)[name];
      if (typeof a !== "function" || typeof b !== "function") continue;
      if (a.toString() !== b.toString()) differ.push(name);
    }
    expect(differ).toEqual([]);
  });
});
