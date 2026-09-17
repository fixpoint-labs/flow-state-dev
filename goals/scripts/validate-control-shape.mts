/**
 * Static shape check for the workforce goals' STRUCTURAL CONTROL PAIRS.
 *
 * A structural control is the fixture that proves `hireWorkforce` refuses a
 * kind whose `configSchema` cannot accept the bag hiring imposes. It is worth
 * nothing unless its refusal has exactly one available cause. Twice now it had
 * two, and both times the goal was green:
 *
 *   R1  The control removed `workerConfigSchema()` and with it every contract
 *       key, so the refusal was equally consistent with hire checking whether
 *       the HELPER WAS CALLED — which it does not and cannot.
 *   R2  The control's schema omitted one key correctly, but its ACTION SET
 *       contained a block whose own `flowConfigSchema` independently required
 *       that same key. The kind was then refused by the block's requirement
 *       whether or not its schema could accept the imposed bag, and the paired
 *       twin still hired only because its schema defaulted the key.
 *
 * R2 is the one worth reading twice, because a check written for R1 does not
 * see it: the fixture satisfies "omits exactly one contract key, paired with a
 * full-bag twin" and is confounded anyway. The property was right and the
 * fixture was still wrong, so this file checks BOTH properties and says plainly
 * below which ones it still cannot reach.
 *
 * ## What this check is, and is not
 *
 * **It is not "does this control isolate one cause".** That question is about
 * intent and no script answers it. What is checkable is a short list of named
 * structural properties that a sound control happens to have, each of which has
 * been violated by a real fixture on this PR. Rules are keyed to those, and to
 * nothing else.
 *
 *   C1  the control's `configSchema` omits EXACTLY ONE contract key
 *   C2  the twin's `configSchema` declares ALL THREE
 *   C3  neither member calls `workerConfigSchema()` — the pair's whole point
 *       is that admission is decided by what a schema accepts, so a member
 *       that composed the helper would reintroduce R1's ambiguity
 *   C4  no block reachable from EITHER member's action set requires the
 *       omitted key through its own `flowConfigSchema`  (the R2 rule)
 *
 * ## What it does NOT cover — read this before trusting a green run
 *
 * C4 names one way an action set can confound a control: a block requiring the
 * OMITTED key. An action set can still confound in ways this does not see — a
 * block requiring some other setting the control's schema happens to lack, a
 * `session` or `resources` slot that refuses first, a twin whose schema accepts
 * the bag for a reason unrelated to the key under test. Those are not rules
 * here because no fixture has yet shown them, and a rule invented ahead of its
 * defect is a rule nobody can prove fires.
 *
 * **A green run means these four properties hold. It does not mean the control
 * is sound.** The gap between the two is intent-shaped, and the honest position
 * is that it stays open rather than that a fifth rule would close it.
 *
 * Run: pnpm tsx goals/scripts/validate-control-shape.mts
 */
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** The keys `hireWorkforce` imposes on every seat it hires. */
const CONTRACT_KEYS = ["instructions", "teamInstructions", "seatSkills"] as const;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The control pairs under this check.
 *
 * Listed rather than discovered: a structural control is not identifiable from
 * its shape — that is the whole problem — so which flows form a pair is a fact
 * about the goal, stated here by whoever wrote it.
 */
const PAIRS = [
  {
    file: "goals/workforce-seats/a-non-agent-seat-receives-its-skills/fixtures/flows.ts",
    control: "noContractFlow",
    twin: "handRolledFlow"
  },
  {
    file: "goals/workforce-seats/two-seats-run-their-own-configuration/fixtures/flows.ts",
    control: "noContractFlow",
    twin: "handRolledFlow"
  }
] as const;

type Consts = Map<string, ts.Expression>;

/** Every top-level `const name = <expr>` in a source file, by name. */
function topLevelConsts(source: ts.SourceFile): Consts {
  const consts: Consts = new Map();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer !== undefined) {
        consts.set(decl.name.text, decl.initializer);
      }
    }
  }
  return consts;
}

/** Follow an identifier to the expression it was declared as. */
function deref(expr: ts.Expression, consts: Consts): ts.Expression {
  let current = expr;
  for (let hops = 0; hops < 10; hops += 1) {
    if (!ts.isIdentifier(current)) return current;
    const next = consts.get(current.text);
    if (next === undefined) return current;
    current = next;
  }
  return current;
}

/**
 * A named property of an object literal, dereferenced through identifiers.
 *
 * Shorthand (`{ actions }`) is read as well as longhand (`{ actions: x }`), and
 * this is not a detail. The first draft of this file handled longhand only, and
 * the fixture it was written against wrote `actions,` — so C4 never ran and the
 * check reported a missing `actions` key instead of the confound it exists to
 * find. It failed, which hid it: a red result from a rule aimed at a NEIGHBOUR
 * of the claim reads exactly like the real thing.
 */
function prop(expr: ts.Expression, name: string, consts: Consts): ts.Expression | undefined {
  let target = deref(expr, consts);
  // A block is declared as `handler({ ... })`, a flow as `defineFlow({ ... })`.
  // Reading the settings of either means reading that single object argument,
  // so unwrap it here rather than making every caller know which it holds.
  if (ts.isCallExpression(target) && target.arguments.length === 1) {
    const [arg] = target.arguments;
    if (arg !== undefined && ts.isObjectLiteralExpression(arg)) target = arg;
  }
  if (!ts.isObjectLiteralExpression(target)) return undefined;
  for (const member of target.properties) {
    if (ts.isShorthandPropertyAssignment(member)) {
      if (member.name.text === name) return member.name;
      continue;
    }
    if (!ts.isPropertyAssignment(member)) continue;
    const key = member.name;
    const text = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined;
    if (text === name) return member.initializer;
  }
  return undefined;
}

/**
 * The top-level keys a `z.object({ ... })` declares.
 *
 * Only the literal form is read. A schema built some other way returns
 * `undefined`, and the caller reports that rather than guessing — an inferred
 * key list would be exactly the confident wrong answer these rules exist to
 * stop.
 */
function zodObjectKeys(expr: ts.Expression, consts: Consts): string[] | undefined {
  const target = deref(expr, consts);
  if (!ts.isCallExpression(target)) return undefined;
  const callee = target.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "object") return undefined;
  const [arg] = target.arguments;
  if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return undefined;
  const keys: string[] = [];
  for (const member of arg.properties) {
    const key = member.name;
    if (key !== undefined && (ts.isIdentifier(key) || ts.isStringLiteral(key))) keys.push(key.text);
  }
  return keys;
}

/** Identifiers passed as arguments anywhere inside an expression. */
function argumentIdentifiers(expr: ts.Expression): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      for (const arg of node.arguments) if (ts.isIdentifier(arg)) found.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(expr);
  return found;
}

/**
 * Every contract key required through a `flowConfigSchema` by a block reachable
 * from an action set, with the block that requires it.
 *
 * Reachability is followed through identifiers, so a block composed into a
 * nested sequencer is reached the same way `defineFlow`'s own walk reaches it.
 */
function requiredContractKeys(
  actions: ts.Expression,
  consts: Consts
): { key: string; block: string }[] {
  const required: { key: string; block: string }[] = [];
  const seen = new Set<string>();

  const visitBlock = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    const decl = consts.get(name);
    if (decl === undefined) return;

    const schema = prop(decl, "flowConfigSchema", consts);
    if (schema !== undefined) {
      for (const key of zodObjectKeys(schema, consts) ?? []) {
        if ((CONTRACT_KEYS as readonly string[]).includes(key)) required.push({ key, block: name });
      }
    }
    // A block may itself be a sequencer chain composing further blocks.
    for (const nested of argumentIdentifiers(decl)) visitBlock(nested);
  };

  const target = deref(actions, consts);
  if (!ts.isObjectLiteralExpression(target)) return required;
  for (const action of target.properties) {
    if (!ts.isPropertyAssignment(action)) continue;
    const block = prop(action.initializer, "block", consts);
    if (block === undefined) continue;
    for (const name of argumentIdentifiers(block)) visitBlock(name);
  }
  return required;
}

function checkPair(pair: (typeof PAIRS)[number]): string[] {
  const path = join(repoRoot, pair.file);
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ESNext, true);
  const consts = topLevelConsts(source);
  const where = relative(repoRoot, path);
  const problems: string[] = [];

  // `export const x = defineFlow({...})` is an ordinary top-level const, so
  // `topLevelConsts` already holds the flows alongside the blocks and schemas.
  const flowOf = (name: string): ts.Expression | undefined => {
    const decl = consts.get(name);
    if (decl === undefined || !ts.isCallExpression(decl)) return undefined;
    const [arg] = decl.arguments;
    return arg;
  };

  const control = flowOf(pair.control);
  const twin = flowOf(pair.twin);
  if (control === undefined || twin === undefined) {
    return [`${where}: could not find defineFlow(...) for "${pair.control}" and/or "${pair.twin}"`];
  }

  const schemaOf = (flow: ts.Expression, who: string): string[] | undefined => {
    const schema = prop(flow, "configSchema", consts);
    if (schema === undefined) {
      problems.push(`${where}: ${who} declares no configSchema`);
      return undefined;
    }
    // C3 — a member that composed the helper reintroduces R1's ambiguity.
    if (schema.getText(source).includes("workerConfigSchema")) {
      problems.push(
        `${where}: ${who} calls workerConfigSchema(). A control pair must hand-write its schema, ` +
          `or its outcome is consistent with hire checking whether the helper was called.`
      );
      return undefined;
    }
    const keys = zodObjectKeys(schema, consts);
    if (keys === undefined) {
      problems.push(`${where}: ${who}'s configSchema is not a literal z.object({...}); this check cannot read it`);
    }
    return keys;
  };

  const controlKeys = schemaOf(control, pair.control);
  const twinKeys = schemaOf(twin, pair.twin);
  if (controlKeys === undefined || twinKeys === undefined) return problems;

  // C1 — exactly one contract key omitted by the control.
  const omitted = CONTRACT_KEYS.filter((key) => !controlKeys.includes(key));
  if (omitted.length !== 1) {
    problems.push(
      `${where}: ${pair.control} omits ${omitted.length} contract key(s) ${JSON.stringify(omitted)}, wanted exactly 1. ` +
        `Omitting none leaves nothing under test; omitting more than one means the refusal has more than one cause.`
    );
    return problems;
  }
  const key = omitted[0]!;

  // C2 — the twin accepts the whole bag, or it is not the positive half.
  const twinMissing = CONTRACT_KEYS.filter((k) => !twinKeys.includes(k));
  if (twinMissing.length > 0) {
    problems.push(
      `${where}: ${pair.twin} omits ${JSON.stringify(twinMissing)}; the twin must accept every imposed key, ` +
        `or it does not show that admission is about what a schema takes.`
    );
  }

  // C4 — the R2 rule, applied to BOTH members.
  for (const [who, flow] of [
    [pair.control, control],
    [pair.twin, twin]
  ] as const) {
    const actions = prop(flow, "actions", consts);
    if (actions === undefined) {
      problems.push(`${where}: ${who} declares no actions`);
      continue;
    }
    for (const required of requiredContractKeys(actions, consts)) {
      if (required.key !== key) continue;
      problems.push(
        `${where}: ${who}'s action set reaches block "${required.block}", whose flowConfigSchema requires ` +
          `"${key}" — the very key ${pair.control} omits. That block refuses this kind on its own, so the pair ` +
          `proves nothing about what the schema accepts. Give the control pair an action set that requires ` +
          `only the kind's own settings.`
      );
    }
  }

  return problems;
}

const problems = PAIRS.flatMap(checkPair);

if (problems.length > 0) {
  console.error(`control-shape check failed (${problems.length} problem(s)):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`control-shape check passed: ${PAIRS.length} control pair(s), rules C1-C4.`);
