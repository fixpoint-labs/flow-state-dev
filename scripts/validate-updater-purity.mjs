/**
 * Enforce that a state-mutation callback never writes to a binding declared
 * outside itself (FIX-995).
 *
 * A mutation callback may run more than once: the CAS retry loop re-invokes it
 * with the freshest committed state after a conflict
 * (`packages/engine/src/stores/cas.ts`). A callback that reports its outcome by
 * writing outward reports whichever attempt wrote last — including attempts
 * that never committed. `withOutcome` / `updateStateWith`
 * (`@flow-state-dev/core/helpers`) give the callback a way to *return* its
 * outcome instead; this check keeps the old shape from coming back.
 *
 * The rule bars three write forms, because the repo has a live example of each
 * and an assignment-only rule provably misses two of them:
 *
 *   found = true          assignment to the binding
 *   culled.push(id)       a mutating call whose RECEIVER is the binding
 *   reclaimed.length = 0  assignment through a member path rooted at the binding
 *
 * (b) is deliberately narrowed to a *known-mutating method on the receiver*
 * rather than "any call rooted at an outer binding". The wider rule red-lights
 * `assertWithinCaps(next)` in `sequencer-backed.ts` — a pure validator declared
 * inside the enclosing factory, passed callback-local state. A check that fails
 * `pnpm typecheck` on safe code gets widened by the first person it blocks, and
 * then it guards nothing.
 *
 * Only bindings declared inside the *enclosing function* count, so module
 * imports and globals are out of scope.
 *
 * Run: `node scripts/validate-updater-purity.mjs [--json]`
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Project, Node, SyntaxKind } from "ts-morph";

const rootDir = process.cwd();

/**
 * Replay entry points: every function that may invoke a caller-supplied
 * callback more than once. Resolved by name, so a wrapper that forwards a
 * caller's callback (`casWrite`) is covered — a direct-argument check would
 * inspect only the wrapper's own internal closure and never see the six
 * callbacks behind it.
 *
 * Any future wrapper must join this list or return its callback's outcome.
 */
const REPLAY_ENTRY_POINTS = new Set([
  "updateState",
  "atomicState",
  "withOutcome",
  "updateStateWith",
  "casWrite",
]);

/**
 * Methods that mutate their receiver. Rule (b) fires only when an outer binding
 * is the receiver of one of these — see the header for why it is not wider.
 */
const MUTATING_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "set",
  "add",
  "delete",
  "clear",
]);

/**
 * The single audited exception: the helper's own module is the one place that
 * must write outward inside a replay callback, because it *is* the mechanism.
 * Asserted to hold exactly one entry so it cannot be quietly broadened into a
 * no-op.
 */
const EXEMPT_FILES = ["packages/core/src/helpers/update-state-with.ts"];

if (EXEMPT_FILES.length !== 1) {
  console.error(
    `[updater-purity] The exemption list must hold exactly one entry (the helper's own module); found ${EXEMPT_FILES.length}.`
  );
  process.exit(1);
}

/**
 * Cheap text pre-filter. A file with no mention of any entry point cannot hold
 * a replay callback, so it never needs parsing — this keeps the check at a
 * couple of seconds, which is what makes it viable inside `pnpm typecheck`.
 */
const ENTRY_POINT_PATTERN = new RegExp(
  `\\b(${[...REPLAY_ENTRY_POINTS].join("|")})\\s*\\(`
);

/** Every first-party source root the check scans: each package's `src`, plus `labs`. */
function sourceRoots() {
  const roots = [];
  const packagesDir = path.join(rootDir, "packages");
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = path.join(packagesDir, entry.name, "src");
    if (fs.existsSync(src)) roots.push(src);
  }
  const labs = path.join(rootDir, "labs");
  if (fs.existsSync(labs)) roots.push(labs);
  return roots;
}

/** Recursively collect `.ts` files (not `.d.ts`), skipping `node_modules` and `dist`. */
function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full, out);
    } else if (entry.isFile() && full.endsWith(".ts") && !full.endsWith(".d.ts")) {
      out.push(full);
    }
  }
}

/** Is `node` a function-shaped expression we can treat as a callback body? */
function isCallbackLike(node) {
  return (
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node)
  );
}

/** The nearest enclosing function-ish scope above `node`, or undefined at module level. */
function enclosingFunction(node) {
  let current = node.getParent();
  while (current !== undefined) {
    if (
      Node.isArrowFunction(current) ||
      Node.isFunctionExpression(current) ||
      Node.isFunctionDeclaration(current) ||
      Node.isMethodDeclaration(current) ||
      Node.isConstructorDeclaration(current) ||
      Node.isGetAccessorDeclaration(current) ||
      Node.isSetAccessorDeclaration(current)
    ) {
      return current;
    }
    current = current.getParent();
  }
  return undefined;
}

/** Does `ancestor` contain `node`? */
function contains(ancestor, node) {
  let current = node;
  while (current !== undefined) {
    if (current === ancestor) return true;
    current = current.getParent();
  }
  return false;
}

/**
 * Resolve `identifier` to its declaration and decide whether it is an "outer
 * binding" relative to `callback`: declared outside the callback, but inside
 * some enclosing function (so module imports and globals do not count).
 */
function isOuterBinding(identifier, callback) {
  const symbol = identifier.getSymbol();
  if (symbol === undefined) return false;

  const declarations = symbol.getDeclarations();
  if (declarations.length === 0) return false;

  for (const declaration of declarations) {
    // Declared inside the callback — the rule is about *enclosing* scopes.
    if (contains(callback, declaration)) return false;

    // Only variable/parameter bindings are candidates. A function declaration
    // or an import is not something a replay can leave stale.
    const isBinding =
      Node.isVariableDeclaration(declaration) ||
      Node.isBindingElement(declaration) ||
      Node.isParameterDeclaration(declaration);
    if (!isBinding) return false;

    // Must live inside a function, not at module scope.
    if (enclosingFunction(declaration) === undefined) return false;
  }

  return true;
}

/** Walk a member-access chain down to the identifier it is rooted at. */
function rootIdentifier(expression) {
  let current = expression;
  while (true) {
    if (Node.isPropertyAccessExpression(current) || Node.isElementAccessExpression(current)) {
      current = current.getExpression();
      continue;
    }
    if (Node.isParenthesizedExpression(current) || Node.isNonNullExpression(current)) {
      current = current.getExpression();
      continue;
    }
    return Node.isIdentifier(current) ? current : undefined;
  }
}

/** Collect every outward write inside `callback`. */
function findOutwardWrites(callback, filePath) {
  const findings = [];

  const record = (node, binding, form, detail) => {
    findings.push({
      file: filePath,
      line: node.getStartLineNumber(),
      binding,
      form,
      detail,
    });
  };

  callback.forEachDescendant((node, traversal) => {
    // Don't descend into a nested replay callback — the outer loop reaches it
    // on its own, with its own notion of which bindings are "outer".
    if (node !== callback && isCallbackLike(node)) {
      const parent = node.getParent();
      if (Node.isCallExpression(parent) && isReplayEntryPointCall(parent)) {
        traversal.skip();
        return;
      }
    }

    // (a) assignment / compound assignment to an outer binding or a member
    //     path rooted at one.
    if (Node.isBinaryExpression(node)) {
      const operator = node.getOperatorToken().getKind();
      const isAssignment =
        operator === SyntaxKind.EqualsToken ||
        (operator >= SyntaxKind.PlusEqualsToken && operator <= SyntaxKind.CaretEqualsToken) ||
        operator === SyntaxKind.BarBarEqualsToken ||
        operator === SyntaxKind.AmpersandAmpersandEqualsToken ||
        operator === SyntaxKind.QuestionQuestionEqualsToken;
      if (isAssignment) {
        const root = rootIdentifier(node.getLeft());
        if (root !== undefined && isOuterBinding(root, callback)) {
          const target = node.getLeft().getText();
          record(
            node,
            root.getText(),
            target === root.getText() ? "assignment" : "property-assignment",
            `${target} = …`
          );
        }
      }
      return;
    }

    // (a) ++ / -- targeting an outer binding.
    if (Node.isPrefixUnaryExpression(node) || Node.isPostfixUnaryExpression(node)) {
      const operator = node.getOperatorToken();
      if (operator === SyntaxKind.PlusPlusToken || operator === SyntaxKind.MinusMinusToken) {
        const root = rootIdentifier(node.getOperand());
        if (root !== undefined && isOuterBinding(root, callback)) {
          record(node, root.getText(), "increment", node.getText());
        }
      }
      return;
    }

    // (a) delete through an outer binding.
    if (Node.isDeleteExpression(node)) {
      const root = rootIdentifier(node.getExpression());
      if (root !== undefined && isOuterBinding(root, callback)) {
        record(node, root.getText(), "delete", node.getText());
      }
      return;
    }

    // (b) a KNOWN-MUTATING method whose RECEIVER is an outer binding.
    if (Node.isCallExpression(node)) {
      const callee = node.getExpression();
      if (Node.isPropertyAccessExpression(callee)) {
        const method = callee.getName();
        if (MUTATING_METHODS.has(method)) {
          const receiver = callee.getExpression();
          const root = rootIdentifier(receiver);
          // The receiver itself must be the outer binding (or a path rooted at
          // it) — not merely a call that happens to sit under one.
          if (root !== undefined && isOuterBinding(root, callback)) {
            record(node, root.getText(), "mutating-call", `${receiver.getText()}.${method}(…)`);
          }
        }
      }
    }
  });

  return findings;
}

/** Is this call expression a call to a registered replay entry point? */
function isReplayEntryPointCall(call) {
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) {
    return REPLAY_ENTRY_POINTS.has(callee.getText());
  }
  if (Node.isPropertyAccessExpression(callee)) {
    return REPLAY_ENTRY_POINTS.has(callee.getName());
  }
  return false;
}

function newProject() {
  return new Project({
    compilerOptions: { allowJs: false, skipLibCheck: true, noLib: true },
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    useInMemoryFileSystem: false,
  });
}

/** Scan one already-parsed source file for outward writes inside replay callbacks. */
function scanSourceFile(sourceFile, label) {
  const findings = [];
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isReplayEntryPointCall(call)) continue;
    for (const argument of call.getArguments()) {
      if (!isCallbackLike(argument)) continue;
      findings.push(...findOutwardWrites(argument, label));
    }
  }
  return findings;
}

/**
 * Analyze in-memory sources. Exported so the check's own rules can be tested
 * against fixtures — one per write form, per wrapper, and per must-not-flag
 * case — without touching the repo's real files.
 *
 * @param {Array<{ path: string, code: string }>} sources
 */
export function analyzeSources(sources) {
  const project = new Project({
    compilerOptions: { allowJs: false, skipLibCheck: true, noLib: true },
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    useInMemoryFileSystem: true,
  });

  const findings = [];
  for (const { path: filePath, code } of sources) {
    const sourceFile = project.createSourceFile(filePath, code, { overwrite: true });
    findings.push(...scanSourceFile(sourceFile, filePath));
  }
  return findings;
}

/** Analyze the repository's real first-party sources. */
export function analyzeRepository() {
  const project = newProject();
  const exempt = new Set(EXEMPT_FILES.map((p) => path.normalize(path.join(rootDir, p))));

  // Collect candidate paths without parsing anything.
  const discovered = [];
  for (const root of sourceRoots()) walk(root, discovered);

  const candidates = [];
  for (const filePath of discovered) {
    const normalized = path.normalize(filePath);
    if (exempt.has(normalized)) continue;
    if (!ENTRY_POINT_PATTERN.test(fs.readFileSync(normalized, "utf8"))) continue;
    candidates.push(normalized);
  }

  for (const filePath of candidates) {
    project.addSourceFileAtPath(filePath);
  }

  const findings = [];
  for (const sourceFile of project.getSourceFiles()) {
    findings.push(
      ...scanSourceFile(sourceFile, path.relative(rootDir, sourceFile.getFilePath()))
    );
  }
  return findings;
}

/** The single audited exemption, exported so a test can assert it stays at one entry. */
export const exemptFiles = EXEMPT_FILES;

function main() {
  const wantJson = process.argv.includes("--json");
  const findings = analyzeRepository();

  if (wantJson) {
    console.log(JSON.stringify(findings, null, 2));
  }

  if (findings.length === 0) {
    if (!wantJson) console.log("[updater-purity] OK — no mutation callback writes outward.");
    return;
  }

  const sites = new Set(findings.map((f) => `${f.file}:${f.line}`));

  if (!wantJson) {
    console.error(
      `[updater-purity] ${findings.length} outward write(s) across ${sites.size} site(s) inside mutation callbacks.\n`
    );
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line}`);
      console.error(
        `  ${finding.form}: \`${finding.detail}\` writes \`${finding.binding}\`, declared outside the callback.`
      );
      console.error(
        `  A mutation callback may run more than once. Return the value instead — see \`updateStateWith\` in @flow-state-dev/core/helpers.\n`
      );
    }
  }

  process.exit(1);
}

// CLI only — importing this module for its analysis must not scan or exit.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
