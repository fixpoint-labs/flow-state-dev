/**
 * FIX-2087 task-surface engine: reads the three rules of `rules.mjs` off a checkout and
 * returns every site it classified. The goal (`run.mts`) and CI (`sweep.mjs`) both call
 * {@link sweepTaskSurface}, so they can't give different answers on one commit (D2).
 *
 * The AST rules (tools, the type-read removed matchers, endings) read one TypeScript program
 * over the product code under `packages/` and `apps/`, resolved through the repository's own
 * `tsconfig.base.json` paths, so no build is needed. The text matchers read every tracked file
 * under the swept roots that `rules.mjs` → `EXCLUDE` doesn't name.
 *
 * `plants` adds files in memory (never on disk), read through the same paths as a real file:
 * `--control` uses it to prove each rule still reports what it exists to catch.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import {
  BEHAVIOUR_ROWS,
  CODE,
  EXCLUDE,
  FORWARDERS,
  INBOX_READ,
  KEEP,
  MIGRATION_TABLE,
  PASS_THROUGHS,
  PERSON_STOPS_REMOVED,
  RECORDERS,
  REFUSAL_MARKER,
  REMOVED,
  ROOTS,
  TEST_CODE,
  TOOLS_ALLOWED,
} from "./rules.mjs";

/**
 * Sweep the checkout at `repo`: its tracked files, or `tracked` when given (a tree extracted
 * from another commit, which has no index), reading the migration table at `table` when given.
 * @param {{ repo: string, plants?: Array<{ path: string, text: string }>, tracked?: string[], table?: string }} options
 * @returns {{ findings: Array<{ rule: string, where: string, what: string }>, cantTell: string[], scanned: Record<string, number>, rows: Array<{ row: string, by: string }>, tools: string[], recorders: Record<string, number>, files: { tracked: number, swept: number, excluded: Map<string, number>, program: number } }}
 */
export function sweepTaskSurface({ repo, plants = [], tracked: given, table: tablePath }) {
  const planted = new Map(plants.map((p) => [p.path, p.text]));
  const tracked = given ?? execFileSync("git", ["ls-files", "--", ...ROOTS], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean);
  const all = [...new Set([...tracked, ...planted.keys()])];
  const read = (path) => planted.get(path) ?? readFileSync(join(repo, path), "utf8");
  const findings = [];
  const scanned = { tools: 0, removedText: 0, removedTyped: 0, endings: 0, marked: 0, kept: 0 };
  const isMarked = (line) => line.includes(REFUSAL_MARKER);

  // ---- the swept files ------------------------------------------------------------
  const excluded = new Map();
  const swept = [];
  for (const path of all) {
    const rule = EXCLUDE.find((r) => r.path.test(path) && !(r.notIf && r.notIf.test(path)));
    if (rule) excluded.set(rule.why, (excluded.get(rule.why) ?? 0) + 1);
    else swept.push(path);
  }

  // ---- the migration table: every name row has a matcher, every behaviour row a goal --------
  const table = readFileSync(tablePath ?? join(repo, MIGRATION_TABLE), "utf8");
  const removedCells = [];
  let inRemoved = false;
  for (const line of table.split("\n")) {
    if (/^\| Removed \|/.test(line)) inRemoved = true;
    else if (/^\| Changed \|/.test(line)) inRemoved = false;
    else if (inRemoved && /^\| (?!---)/.test(line)) removedCells.push(line.split("|")[1].trim());
  }
  const rows = [];
  for (const cell of removedCells) {
    const matchers = REMOVED.filter((m) => cell.includes(m.row));
    const goal = Object.entries(BEHAVIOUR_ROWS).find(([phrase]) => cell.includes(phrase))?.[1];
    if (matchers.length === 0 && goal === undefined) {
      findings.push({ rule: "removed", where: MIGRATION_TABLE, what: `a row no matcher or goal covers: ${cell.slice(0, 120)}` });
    }
    rows.push({ row: cell, by: [...matchers.map((m) => `${m.kind} matcher`), ...(goal ? [`goal ${goal}`] : [])].join(" + ") || "NOTHING" });
  }

  // ---- removed · text matchers over the swept files ---------------------------------------
  // FIX-2058's person-stop ratchet rides the same text pass (FIX-2134 D2).
  const SWEPT = REMOVED.find((m) => m.kind === "text").files;
  const personStops = PERSON_STOPS_REMOVED.map((p) => ({
    row: `person stop \`${p.name}\``,
    kind: "text",
    files: p.files ?? SWEPT,
    pattern: new RegExp(`\\b${p.name}\\b`),
    owner: p.owner,
  }));
  const textMatchers = [...REMOVED.filter((m) => m.kind === "text"), ...personStops];
  for (const path of swept) {
    const applicable = textMatchers.filter((m) => m.files.test(path) && !(m.notFiles && m.notFiles.test(path)));
    if (applicable.length === 0) continue;
    const lines = read(path).split("\n");
    const isCodeFile = CODE.test(path);
    lines.forEach((line, i) => {
      // A comment says what code does; a removed name in one is history, not a live surface.
      if (isCodeFile && /^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const m of applicable) {
        if (!m.pattern.test(line)) continue;
        scanned.removedText++;
        if (isMarked(line)) {
          scanned.marked++;
          continue;
        }
        if (KEEP.some((k) => k.path.test(path) && k.line.test(line.trim()))) {
          scanned.kept++;
          continue;
        }
        findings.push({ rule: "removed", where: `${path}:${i + 1}`, what: `${m.row} (${m.owner}) live: ${line.trim().slice(0, 140)}` });
      }
    });
  }

  // ---- the program --------------------------------------------------------------------------
  const productCode = all.filter((p) => CODE.test(p) && !TEST_CODE.test(p));
  const config = ts.parseJsonConfigFileContent(ts.readConfigFile(join(repo, "tsconfig.base.json"), ts.sys.readFile).config, ts.sys, repo);
  const options = { ...config.options, noEmit: true, skipLibCheck: true, allowJs: false, jsx: ts.JsxEmit.Preserve, allowImportingTsExtensions: true };
  const host = ts.createCompilerHost(options);
  const plainRead = host.readFile.bind(host);
  const plainExists = host.fileExists.bind(host);
  const abs = (p) => join(repo, p);
  const plantedAbs = new Map([...planted].map(([p, t]) => [abs(p), t]));
  host.readFile = (f) => plantedAbs.get(f) ?? plainRead(f);
  host.fileExists = (f) => plantedAbs.has(f) || plainExists(f);
  const baseGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lang, onError, create) =>
    plantedAbs.has(f) ? ts.createSourceFile(f, plantedAbs.get(f), lang, true) : baseGetSourceFile(f, lang, onError, create);
  const program = ts.createProgram({ rootNames: productCode.map(abs), options, host });
  const checker = program.getTypeChecker();
  const rel = (sf) => sf.fileName.slice(repo.length + 1);
  const ownFiles = program.getSourceFiles().filter((sf) => sf.fileName.startsWith(repo) && !sf.fileName.includes("/node_modules/") && productCode.includes(rel(sf)));
  const packageOf = (path) => /^(packages|apps)\/([^/]+)\//.exec(path)?.[2] ?? "?";
  const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const lineText = (sf, node) => sf.text.split("\n")[lineOf(sf, node) - 1] ?? "";

  // ---- tools · every task tool the capability declares --------------------------------------
  // A tool is a call of one of core's five block builders, read by symbol: any import name, a
  // namespace member, a local alias, or `.withDefaults`. Read in the file that defines
  // `createTaskToolsCapability` and, transitively, the files it imports from that same directory.
  // A tool imported from another directory is not read: the task board's handler blocks live
  // there and are not tools. An allowed name that was not read is CAN'T TELL.
  const cantTell = [];
  const resolveAlias = (sym) => (sym && sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym);
  const symbolOf = (expr) => resolveAlias(checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expr) ? expr.name : expr));
  // Any of core's five block builders: a generator's tool is any block (`GeneratorTool`).
  const CORE_BUILDER = /\/packages\/core\/(src|dist)\/blocks\/(handler|generator|sequencer|router|evaluator)\.(d\.)?ts$/;
  const BUILDERS = ["handler", "generator", "sequencer", "router", "evaluator"];
  const isCoreHandler = (sym) =>
    (sym?.declarations ?? []).some((d) => CORE_BUILDER.test(d.getSourceFile().fileName) && (ts.isFunctionDeclaration(d) || ts.isModuleDeclaration(d)) && BUILDERS.includes(d.name?.text));
  /** Whether `expr` is core's `handler`, through aliases, local variables, conditionals and `.withDefaults`. */
  const buildsTool = (expr, depth = 0) => {
    if (expr === undefined || depth > 8) return false;
    if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr) || ts.isSatisfiesExpression?.(expr)) return buildsTool(expr.expression, depth + 1);
    if (ts.isConditionalExpression(expr)) return buildsTool(expr.whenTrue, depth + 1) || buildsTool(expr.whenFalse, depth + 1);
    if (ts.isBinaryExpression(expr)) return buildsTool(expr.left, depth + 1) || buildsTool(expr.right, depth + 1);
    if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) && expr.expression.name.text === "withDefaults") return buildsTool(expr.expression.expression, depth + 1);
    if (!ts.isIdentifier(expr) && !ts.isPropertyAccessExpression(expr)) return false;
    const sym = symbolOf(expr);
    if (isCoreHandler(sym)) return true;
    return (sym?.declarations ?? []).some((d) => ts.isVariableDeclaration(d) && d.initializer !== undefined && buildsTool(d.initializer, depth + 1));
  };
  const nameOfTool = (obj) => {
    const prop = obj.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === "name");
    if (!prop) return "(no name read)";
    const init = prop.initializer;
    if (ts.isStringLiteralLike(init)) return init.text;
    if (ts.isCallExpression(init) && init.expression.getText() === "named" && init.arguments[0] && ts.isStringLiteralLike(init.arguments[0])) return init.arguments[0].text;
    return `(computed: ${init.getText()})`;
  };
  const byFile = new Map(ownFiles.map((sf) => [sf.fileName, sf]));
  const capabilityFiles = ownFiles.filter((sf) => sf.statements.some((s) => ts.isFunctionDeclaration(s) && s.name?.text === "createTaskToolsCapability"));
  const toolScope = new Set();
  const dirOf = (f) => f.slice(0, f.lastIndexOf("/") + 1);
  const pending = capabilityFiles.map((sf) => [sf, dirOf(sf.fileName)]);
  while (pending.length > 0) {
    const [sf, dir] = pending.pop();
    if (toolScope.has(sf)) continue;
    toolScope.add(sf);
    for (const s of sf.statements) {
      if (!(ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) || !s.moduleSpecifier || !ts.isStringLiteral(s.moduleSpecifier)) continue;
      const to = ts.resolveModuleName(s.moduleSpecifier.text, sf.fileName, options, host).resolvedModule?.resolvedFileName;
      const next = to === undefined ? undefined : byFile.get(to);
      if (next !== undefined && dirOf(next.fileName) === dir) pending.push([next, dir]);
    }
  }
  const tools = [];
  for (const sf of toolScope) {
    const visit = (node) => {
      if (ts.isCallExpression(node) && buildsTool(node.expression)) {
        let config = node.arguments[0];
        while (config !== undefined && (ts.isAsExpression(config) || ts.isParenthesizedExpression(config) || ts.isSatisfiesExpression?.(config))) config = config.expression;
        const name = config !== undefined && ts.isObjectLiteralExpression(config) ? nameOfTool(config) : `(config not read: ${config?.getText(sf).slice(0, 60) ?? "none"})`;
        scanned.tools++;
        tools.push(name);
        if (!TOOLS_ALLOWED.has(name) && !isMarked(lineText(sf, node))) {
          findings.push({ rule: "tools", where: `${rel(sf)}:${lineOf(sf, node)}`, what: `the task surface offers "${name}", which is not one of the five, holdTaskForUser or suspendForUser` });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  if (capabilityFiles.length === 0) cantTell.push("tools: no file defines createTaskToolsCapability");
  const unread = [...TOOLS_ALLOWED].filter((n) => !tools.includes(n));
  if (unread.length > 0) cantTell.push(`tools: the allowed tools ${unread.join(", ")} were not read, so the rule stopped reading the capability`);

  // ---- removed · typed matchers (declared props, members called, union members, doors) -----
  const typeDecls = (name, module) =>
    ownFiles
      .filter((sf) => module === undefined || rel(sf).startsWith(`packages/${module.split("/")[0]}/src/`))
      .flatMap((sf) => sf.statements.filter((s) => (ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s)) && s.name.text === name).map((s) => ({ sf, s })));
  for (const m of REMOVED.filter((x) => x.kind === "declared" || x.kind === "union")) {
    const decls = typeDecls(m.type, m.module);
    if (decls.length === 0) {
      findings.push({ rule: "removed", where: MIGRATION_TABLE, what: `CAN'T TELL: ${m.row}: no type ${m.type}${m.module ? ` in ${m.module}` : ""} to read` });
      continue;
    }
    for (const { sf, s } of decls) {
      const type = checker.getTypeAtLocation(s.name);
      scanned.removedTyped++;
      if (m.kind === "declared") {
        for (const prop of m.props) {
          const sym = type.getProperty(prop) ?? checker.getApparentType(type).getProperty?.(prop);
          if (!sym) continue;
          const decl = sym.declarations?.[0];
          const dsf = decl?.getSourceFile();
          if (decl && dsf && isMarked(dsf.text.split("\n")[dsf.getLineAndCharacterOfPosition(decl.getStart()).line] ?? "")) continue;
          findings.push({ rule: "removed", where: `${rel(sf)}:${lineOf(sf, s)}`, what: `${m.row} (${m.owner}) live: ${m.type}.${prop} is declared` });
        }
      } else {
        const members = type.isUnion() ? type.types : [type];
        for (const member of members) {
          if (member.isStringLiteral() && m.members.includes(member.value)) {
            findings.push({ rule: "removed", where: `${rel(sf)}:${lineOf(sf, s)}`, what: `${m.row} (${m.owner}) live: ${m.type} still has "${member.value}"` });
          }
        }
      }
    }
  }
  const memberRules = REMOVED.filter((x) => x.kind === "member");
  const doorRule = REMOVED.find((x) => x.kind === "door");
  /** Whether `expr` resolves, by symbol, to core's `defineFlow`. */
  const isCoreDefineFlow = (expr) => (symbolOf(expr)?.declarations ?? []).some((d) => /\/packages\/core\/(src|dist)\/flow\/defineFlow\.(d\.)?ts$/.test(d.getSourceFile().fileName));
  /** The worker contract's keys: the shape `workerConfigSchema()` returns, read from its declaration. */
  const contractKeys = (() => {
    for (const sf of ownFiles) {
      if (!rel(sf).startsWith("packages/workforce/src/")) continue;
      const decl = sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === "workerConfigSchema");
      if (decl === undefined) continue;
      const shape = checker.getReturnTypeOfSignature(checker.getSignatureFromDeclaration(decl)).getProperty("shape");
      return shape === undefined ? [] : checker.getTypeOfSymbolAtLocation(shape, decl).getProperties().map((p) => p.name);
    }
    return [];
  })();
  if (doorRule && contractKeys.length === 0) cantTell.push("removed: workerConfigSchema's keys weren't read, so a worker flow can't be told");
  /** Whether a `defineFlow` config's `configSchema` is typed with every key of the worker contract. */
  const isWorkerConfig = (config) => {
    if (contractKeys.length === 0) return false;
    const prop = config.properties.find((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === "configSchema");
    if (prop === undefined) return false;
    const shape = checker.getApparentType(checker.getTypeAtLocation(ts.isPropertyAssignment(prop) ? prop.initializer : prop.name)).getProperty("shape");
    if (shape === undefined) return false;
    const keys = new Set(checker.getTypeOfSymbolAtLocation(shape, prop).getProperties().map((p) => p.name));
    return contractKeys.every((k) => keys.has(k));
  };
  /** An action's key: a literal name, or a computed one whose type is a string literal (`[RUN_ACTION]`). */
  const actionKey = (p, sf) => {
    if (p.name === undefined) return undefined;
    if (ts.isComputedPropertyName(p.name)) {
      const t = checker.getTypeAtLocation(p.name.expression);
      return t.isStringLiteral() ? t.value : undefined;
    }
    return p.name.getText(sf).replace(/["']/g, "");
  };
  const workerFlows = [];

  // ---- endings · read by type ---------------------------------------------------------------
  // A task collection is any value whose type has the collection's lifecycle: claim, complete,
  // fail and cancel. Its `complete` or `fail` called, or its `cancel` called with the caller's
  // own claim (in any shape: `.call`, `.apply`, element access, destructured), is an ending; so
  // is a cancel handed on (`.bind`, passed as a value), and a call of a pass-through helper.
  const isCollection = (type) => {
    const t = checker.getApparentType(checker.getNonNullableType(type));
    return ["claim", "complete", "fail", "cancel"].every((p) => t.getProperty(p) !== undefined);
  };
  /** Whether a method's symbol is declared on a task collection interface (a `Pick` of one keeps it). */
  const declaredOnCollection = (name) =>
    (checker.getSymbolAtLocation(name)?.declarations ?? []).some((d) => {
      for (let n = d.parent; n; n = n.parent) if (ts.isInterfaceDeclaration(n)) return /^TaskCollection/.test(n.name.text);
      return false;
    });
  const passesClaim = (arg) => {
    if (arg === undefined) return false;
    const t = checker.getApparentType(checker.getTypeAtLocation(arg));
    const claim = t.getProperty("claim");
    if (!claim) return false;
    const ct = checker.getTypeOfSymbolAtLocation(claim, arg);
    return !(ct.flags & ts.TypeFlags.Undefined) && !(ct.flags & ts.TypeFlags.Never);
  };
  /** The name a function is known by: a declaration, a method, or a variable holding one (or, at module scope, a call's result). */
  const nameOfFunction = (n) => {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText();
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) return n.parent.name.text;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isCallExpression(n.initializer) && n.parent.parent && ts.isVariableStatement(n.parent.parent) && n.parent.parent.parent === n.getSourceFile()) return n.name.text;
    return undefined;
  };
  /** The nearest enclosing named function; anonymous ones are looked through. */
  const recorderOf = (node) => {
    for (let n = node.parent; n; n = n.parent) {
      const name = nameOfFunction(n);
      if (name !== undefined) return name;
    }
    return "(module scope)";
  };
  // A recorder, and a pass-through, is keyed by name, so each key must name exactly one function:
  // a second function of that name in the package would be read as the recorder.
  const declared = new Map();
  const keyed = new Set([...Object.keys(RECORDERS), ...Object.keys(FORWARDERS), ...PASS_THROUGHS.map((p) => `orchestration:${p}`)]);
  for (const sf of ownFiles) {
    const visit = (node) => {
      const name = nameOfFunction(node);
      const key = name === undefined ? undefined : `${packageOf(rel(sf))}:${name}`;
      if (key !== undefined && keyed.has(key)) declared.set(key, [...(declared.get(key) ?? []), `${rel(sf)}:${lineOf(sf, node)}`]);
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  for (const key of keyed) {
    const at = declared.get(key) ?? [];
    if (at.length === 1) continue;
    const what = `CAN'T TELL: ${key} names ${at.length} functions, so its writes can't be told from another's`;
    cantTell.push(`endings: ${what}`);
    findings.push({ rule: "endings", where: at.join(" and ") || MIGRATION_TABLE, what });
  }
  /** The pass-through helper `expr` resolves to by symbol (a renamed import, a re-export, a namespace member, a local alias), if any. */
  const passThroughOf = (expr, depth = 0) => {
    if (expr === undefined || depth > 8) return undefined;
    if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr)) return passThroughOf(expr.expression, depth + 1);
    if (!ts.isIdentifier(expr) && !ts.isPropertyAccessExpression(expr)) return undefined;
    for (const d of symbolOf(expr)?.declarations ?? []) {
      if (ts.isFunctionDeclaration(d) && d.name && PASS_THROUGHS.includes(d.name.text) && packageOf(rel(d.getSourceFile())) === "orchestration") return d.name.text;
      if (ts.isVariableDeclaration(d) && d.initializer) {
        const via = passThroughOf(d.initializer, depth + 1);
        if (via !== undefined) return via;
      }
      // `const { advisoryFail: f } = writes`: the property the binding reads.
      if (ts.isBindingElement(d)) {
        const prop = d.propertyName ?? d.name;
        if (ts.isIdentifier(prop)) {
          const via = (resolveAlias(checker.getSymbolAtLocation(prop))?.declarations ?? []).find(
            (x) => ts.isFunctionDeclaration(x) && x.name && PASS_THROUGHS.includes(x.name.text) && packageOf(rel(x.getSourceFile())) === "orchestration",
          );
          if (via !== undefined) return via.name.text;
        }
      }
    }
    return undefined;
  };
  /** Whether `node` names a pass-through as a value (handed on, not called): not a callee, a declaration, an import or a type. */
  const passedOn = (node) => {
    const p = node.parent;
    if (ts.isIdentifier(node) && ts.isPropertyAccessExpression(p) && p.name === node) return false;
    if (ts.isCallExpression(p) && p.expression === node) return false;
    if (ts.isPropertyAccessExpression(p) && p.expression === node && ["call", "apply", "bind"].includes(p.name.text)) return false;
    if (ts.isVariableDeclaration(p) && (p.initializer === node || p.name === node)) return false;
    if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isBindingElement(p) || ts.isTypeQueryNode(p)) return false;
    if ((ts.isFunctionDeclaration(p) || ts.isParameter(p)) && p.name === node) return false;
    return true;
  };
  const ENDS = ["complete", "fail"];
  const onCollection = (receiver, name) => isCollection(checker.getTypeAtLocation(receiver)) || (name !== undefined && declaredOnCollection(name));
  /**
   * Whether `expr` is a task collection's `cancel` in a shape other than `x.cancel`: `x["cancel"]`,
   * or a name destructured from a collection (`const { cancel: c } = x`). A cancel is an ending
   * only under the caller's own claim, so the call's claim argument decides, as for `x.cancel(...)`.
   */
  const isCancelRef = (expr) => {
    if (ts.isElementAccessExpression(expr)) return ts.isStringLiteralLike(expr.argumentExpression) && expr.argumentExpression.text === "cancel" && isCollection(checker.getTypeAtLocation(expr.expression));
    if (!ts.isIdentifier(expr)) return false;
    return (checker.getSymbolAtLocation(expr)?.declarations ?? []).some(
      (d) => ts.isBindingElement(d) && ts.isObjectBindingPattern(d.parent) && (d.propertyName ?? d.name).getText() === "cancel" && isCollection(checker.getTypeAtLocation(d.parent)),
    );
  };
  /** `x.cancel` or {@link isCancelRef}: any reference to a task collection's cancel. */
  const isAnyCancel = (expr) => (ts.isPropertyAccessExpression(expr) && expr.name.text === "cancel" && onCollection(expr.expression, expr.name)) || isCancelRef(expr);
  /**
   * The ending a call of a collection's cancel makes, through `.call`/`.apply` or a shape
   * {@link isCancelRef} reads (`x.cancel(...)` itself is read below, with the removed members).
   * `.apply` with an argument list it can't read counts, since its claim can't be told apart.
   */
  const cancelCallEnding = (node, sf) => {
    const callee = node.expression;
    if (isCancelRef(callee)) return passesClaim(node.arguments[2]) ? `${callee.getText(sf)}() under the caller's own claim` : undefined;
    if (!ts.isPropertyAccessExpression(callee) || !isAnyCancel(callee.expression)) return undefined;
    const how = callee.name.text;
    if (how === "call") return passesClaim(node.arguments[3]) ? `${callee.getText(sf)}() under the caller's own claim` : undefined;
    if (how === "apply") {
      const list = node.arguments[1];
      if (list !== undefined && ts.isArrayLiteralExpression(list)) return passesClaim(list.elements[2]) ? `${callee.getText(sf)}() under the caller's own claim` : undefined;
      return `${callee.getText(sf)}() with arguments it can't read`;
    }
    return undefined;
  };
  /**
   * A collection's cancel handed on rather than called (`.bind`, passed as a value): what is
   * done with it later can't be read, so it counts as an ending, as a handed-on complete or fail does.
   */
  const cancelHandedOn = (node) => {
    if (!isAnyCancel(node)) return false;
    const p = node.parent;
    if (ts.isCallExpression(p) && p.expression === node) return false;
    if (ts.isPropertyAccessExpression(p) && p.expression === node && ["call", "apply"].includes(p.name.text)) return false;
    if (ts.isIdentifier(node) && ts.isPropertyAccessExpression(p) && p.name === node) return false;
    if ((ts.isVariableDeclaration(p) && p.name === node) || ts.isBindingElement(p)) return false;
    return true;
  };
  const recorders = {};
  for (const sf of ownFiles) {
    const path = rel(sf);
    const visit = (node) => {
      let ending;
      // The shapes that hand a collection's write on rather than make it: a `.bind`/`.call`/`.apply`
      // receiver, an element access by a non-literal key, a property access not called directly.
      let forwards = false;
      if (ts.isPropertyAccessExpression(node) && ENDS.includes(node.name.text) && onCollection(node.expression, node.name)) {
        ending = `${node.getText(sf)}`;
        // Called, or called through `.call`/`.apply` (`ref.fail.call(ref, …)`), is a write made
        // here; only a reference handed on (`.bind`, passed as a value) forwards.
        const viaCall = ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node && ["call", "apply"].includes(node.parent.name.text) && ts.isCallExpression(node.parent.parent) && node.parent.parent.expression === node.parent;
        forwards = !((ts.isCallExpression(node.parent) && node.parent.expression === node) || viaCall);
      } else if (ts.isElementAccessExpression(node) && isCollection(checker.getTypeAtLocation(node.expression))) {
        const arg = node.argumentExpression;
        if (!ts.isStringLiteralLike(arg) || ENDS.includes(arg.text)) ending = `${node.getText(sf)} (element access)`;
        forwards = !ts.isStringLiteralLike(arg);
      } else if ((ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) && passedOn(node) && passThroughOf(node) !== undefined) {
        ending = `${node.getText(sf)} (${passThroughOf(node)}, handed on as a value)`;
      } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
        const prop = (node.propertyName ?? node.name).getText(sf);
        if (ENDS.includes(prop) && isCollection(checker.getTypeAtLocation(node.parent))) ending = `${prop} destructured from a task collection`;
      } else if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isIdentifier(node)) && cancelHandedOn(node)) {
        ending = `${node.getText(sf)} (a task collection's cancel, handed on)`;
        forwards = true;
      }
      if (ts.isCallExpression(node)) {
        if (ts.isPropertyAccessExpression(node.expression)) {
          const method = node.expression.name.text;
          if (["cancel", ...memberRules.flatMap((m) => m.props)].includes(method) && onCollection(node.expression.expression, node.expression.name)) {
            for (const m of memberRules) {
              if (m.props.includes(method) && !isMarked(lineText(sf, node))) {
                findings.push({ rule: "removed", where: `${path}:${lineOf(sf, node)}`, what: `${m.row} (${m.owner}) live: a task collection's ${method}() is called` });
              }
            }
            if (method === "cancel" && passesClaim(node.arguments[2])) ending = `${node.expression.getText(sf)}() under the caller's own claim`;
          }
        }
        ending ??= cancelCallEnding(node, sf);
        const helper = passThroughOf(node.expression);
        if (helper !== undefined) {
          if (helper !== "advisoryCancel" || passesClaim(node.arguments[3])) ending = `${node.expression.getText(sf)}() (${helper})`;
        } else if (ts.isPropertyAccessExpression(node.expression) && ["call", "apply", "bind"].includes(node.expression.name.text)) {
          const via = passThroughOf(node.expression.expression);
          if (via !== undefined) ending = `${node.expression.getText(sf)}() (${via})`;
        }
      }
      if (ending !== undefined) {
        const fn = recorderOf(node);
        const key = `${packageOf(path)}:${fn}`;
        scanned.endings++;
        if (key.startsWith("orchestration:") && PASS_THROUGHS.includes(fn)) {
          // The helper's own write: its callers are read in its place.
        } else if (key in FORWARDERS && forwards) {
          // A collection wrapper handing its own complete or fail on: its callers are read in its
          // place. A direct write inside it is still a finding.
        } else if (key in RECORDERS) {
          recorders[key] = (recorders[key] ?? 0) + 1;
        } else if (!isMarked(lineText(sf, node))) {
          findings.push({ rule: "endings", where: `${path}:${lineOf(sf, node)}`, what: `${ending} in ${key}, which is not a recorder` });
        }
      }
      // A worker flow's door: a call of core's `defineFlow` (by symbol) that declares the `respond`
      // door or whose `configSchema` is typed with every key of Workforce's worker contract
      // (`workerConfigSchema()`), however either is built.
      let config = ts.isCallExpression(node) ? node.arguments[0] : undefined;
      // `defineFlow({ ... } as never)`, as the coordinator's is: the config under its cast.
      while (config !== undefined && (ts.isAsExpression(config) || ts.isParenthesizedExpression(config) || ts.isSatisfiesExpression?.(config))) config = config.expression;
      if (doorRule && ts.isCallExpression(node) && isCoreDefineFlow(node.expression) && config !== undefined && ts.isObjectLiteralExpression(config)) {
        const actions = config.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === "actions");
        // The contract's one door, `respond` (worker-door.ts), marks a worker flow too: a configSchema
        // typed only as some zod object (the coordinator's, from its turn's settings) carries no keys to read.
        const hasRespond = actions !== undefined && ts.isObjectLiteralExpression(actions.initializer) && actions.initializer.properties.some((p) => actionKey(p, sf) === "respond");
        if ((hasRespond || isWorkerConfig(config)) && actions && ts.isObjectLiteralExpression(actions.initializer)) {
          scanned.removedTyped++;
          workerFlows.push(`${path}:${lineOf(sf, node)}`);
          for (const p of actions.initializer.properties) {
            const key = actionKey(p, sf);
            if (key !== undefined && doorRule.names.includes(key) && !isMarked(lineText(sf, p))) {
              findings.push({ rule: "removed", where: `${path}:${lineOf(sf, p)}`, what: `${doorRule.row} (${doorRule.owner}) live: a worker flow declares the door "${key}"` });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  // ---- inbox · one item type, built in one place (FIX-2133) -----------------------------------
  // Read by type: an object literal typed as orchestration's `InboxItem` (its contextual type, a cast
  // included), or one whose own type carries an item's `task`, `holds` and `answerable` however
  // its properties are written (shorthand, spread). Allowed only in a function `INBOX_READ` names:
  // an item is the only thing an Inbox can draw, so building one is the only way to list one.
  const INBOX_MODULE = "packages/orchestration/src/inbox/types.ts";
  const declaredIn = (sym, module, name) => (sym?.declarations ?? []).some((d) => rel(d.getSourceFile()) === module && (name === undefined || d.name?.getText?.() === name));
  const typeDeclaredIn = (type, module, name) => {
    if (type === undefined) return false;
    if (declaredIn(type.aliasSymbol, module, name)) return true;
    return type.isUnion() && type.types.some((t) => declaredIn(t.aliasSymbol, module, name));
  };
  const inboxItemDecl = ownFiles.find((sf) => rel(sf) === INBOX_MODULE)?.statements.find((s) => ts.isTypeAliasDeclaration(s) && s.name.text === "InboxItem");
  // A tree with no Inbox read (a commit from before it, swept with `--at`) has a second list by
  // definition: a finding, not a rule that read nothing.
  if (inboxItemDecl === undefined) findings.push({ rule: "inbox", where: INBOX_MODULE, what: "no InboxItem type: there is no one Inbox read, so every list of what waits on the user is its own" });
  const ITEM_SHAPE = ["task", "holds", "answerable"];
  // A literal typed `any` or `unknown` (a spread of an `any` value) is no item: every slot accepts it.
  const isInboxItem = (node) => {
    if (typeDeclaredIn(checker.getContextualType(node), INBOX_MODULE, "InboxItem")) return true;
    const own = checker.getTypeAtLocation(node);
    if (own.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;
    return ITEM_SHAPE.every((p) => own.getProperty(p) !== undefined);
  };
  const inboxScanned = { items: 0 };
  for (const sf of ownFiles) {
    const path = rel(sf);
    const visit = (node) => {
      // Any syntax that can give the literal an item's `holds`: assigned, shorthand, quoted or computed, or a spread.
      const mayHoldHolds = (p) =>
        ts.isSpreadAssignment(p) || (p.name !== undefined && (ts.isComputedPropertyName(p.name) || p.name.getText(sf).replace(/["']/g, "") === "questions"));
      if (inboxItemDecl !== undefined && ts.isObjectLiteralExpression(node) && node.properties.some(mayHoldHolds) && isInboxItem(node)) {
        inboxScanned.items++;
        const key = `${packageOf(path)}:${recorderOf(node)}`;
        if (!(key in INBOX_READ) && !isMarked(lineText(sf, node))) {
          findings.push({ rule: "inbox", where: `${path}:${lineOf(sf, node)}`, what: `builds an Inbox item in ${key}, outside the Inbox read: a second list of what waits on the user` });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  // The floor: the Inbox read itself must be read, or the rule is reading nothing.
  if (inboxItemDecl !== undefined && inboxScanned.items === 0) cantTell.push("inbox: no object typed as InboxItem was read, so the rule can't see an Inbox item being built");
  scanned.inbox = inboxScanned.items;
  for (const key of inboxItemDecl === undefined ? [] : Object.keys(INBOX_READ)) {
    const at = [];
    for (const sf of ownFiles) {
      const visit = (node) => {
        const name = nameOfFunction(node);
        if (name !== undefined && `${packageOf(rel(sf))}:${name}` === key) at.push(`${rel(sf)}:${lineOf(sf, node)}`);
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    if (at.length !== 1) {
      const what = `CAN'T TELL: ${key} names ${at.length} functions, so the Inbox read can't be told from another`;
      cantTell.push(`inbox: ${what}`);
      findings.push({ rule: "inbox", where: at.join(" and ") || "rules.mjs", what });
    }
  }

  const unreadFlows = (doorRule?.floor ?? []).filter((f) => !workerFlows.some((w) => w.startsWith(`${f}:`)));
  if (unreadFlows.length > 0) cantTell.push(`removed: the door rule read no worker flow in ${unreadFlows.join(", ")}, so it stopped reading the built-in flows`);

  return {
    findings,
    cantTell,
    scanned,
    rows,
    tools,
    recorders,
    workerFlows,
    files: { tracked: tracked.length, swept: swept.length, excluded, program: ownFiles.length },
  };
}
