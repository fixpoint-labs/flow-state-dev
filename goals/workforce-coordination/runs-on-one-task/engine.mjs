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
  KEEP,
  MIGRATION_TABLE,
  PASS_THROUGHS,
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
 * @returns {{ findings: Array<{ rule: string, where: string, what: string }>, scanned: Record<string, number>, rows: Array<{ row: string, by: string }>, tools: string[], recorders: Record<string, number>, files: { tracked: number, swept: number, excluded: Map<string, number>, program: number } }}
 */
export function sweepTaskSurface({ repo, plants = [], tracked: given, table: tablePath }) {
  const planted = new Map(plants.map((p) => [p.path, p.text]));
  const tracked = given ?? execFileSync("git", ["ls-files", "--", ...ROOTS], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean);
  const all = [...tracked, ...planted.keys()];
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
  const textMatchers = REMOVED.filter((m) => m.kind === "text");
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
  // The capability's file is found by what it declares, not by its path: every tool built with
  // `defineTool` or `handler` in the file that defines `createTaskToolsCapability`, and every
  // `defineTool` anywhere in the product code.
  const nameOfTool = (obj) => {
    const prop = obj.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === "name");
    if (!prop) return undefined;
    const init = prop.initializer;
    if (ts.isStringLiteralLike(init)) return init.text;
    if (ts.isCallExpression(init) && init.expression.getText() === "named" && init.arguments[0] && ts.isStringLiteralLike(init.arguments[0])) return init.arguments[0].text;
    return `(computed: ${init.getText()})`;
  };
  const tools = [];
  for (const sf of ownFiles) {
    const isCapabilityFile = /function\s+createTaskToolsCapability\b/.test(sf.text);
    const visit = (node) => {
      if (ts.isCallExpression(node) && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
        const callee = node.expression.getText(sf);
        if (callee === "defineTool" || (isCapabilityFile && callee === "handler")) {
          const name = nameOfTool(node.arguments[0]);
          if (name !== undefined) {
            scanned.tools++;
            tools.push(name);
            if (!(name in TOOLS_ALLOWED) && !isMarked(lineText(sf, node.arguments[0]))) {
              findings.push({ rule: "tools", where: `${rel(sf)}:${lineOf(sf, node)}`, what: `the task surface offers "${name}", which is not one of the five, answerTask or parkOnQuestion` });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

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

  // ---- endings · read by type ---------------------------------------------------------------
  // A task collection is any value whose type has the collection's lifecycle: claim, complete,
  // fail and cancel. Its `complete` or `fail` called, or its `cancel` called with the caller's
  // own claim, is an ending; so is a call of a pass-through helper.
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
  /** The nearest enclosing named function (declaration, method, or a variable holding one); anonymous ones are looked through. */
  const recorderOf = (node) => {
    for (let n = node.parent; n; n = n.parent) {
      if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText();
      if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) return n.parent.name.text;
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isCallExpression(n.initializer) && n.parent.parent && ts.isVariableStatement(n.parent.parent) && n.parent.parent.parent === n.getSourceFile()) return n.name.text;
    }
    return "(module scope)";
  };
  const recorders = {};
  for (const sf of ownFiles) {
    const path = rel(sf);
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        let ending;
        if (ts.isPropertyAccessExpression(node.expression)) {
          const method = node.expression.name.text;
          if (["complete", "fail", "cancel", ...memberRules.flatMap((m) => m.props)].includes(method) && (isCollection(checker.getTypeAtLocation(node.expression.expression)) || declaredOnCollection(node.expression.name))) {
            for (const m of memberRules) {
              if (m.props.includes(method) && !isMarked(lineText(sf, node))) {
                findings.push({ rule: "removed", where: `${path}:${lineOf(sf, node)}`, what: `${m.row} (${m.owner}) live: a task collection's ${method}() is called` });
              }
            }
            if (method === "complete" || method === "fail") ending = `${node.expression.getText(sf)}()`;
            if (method === "cancel" && passesClaim(node.arguments[2])) ending = `${node.expression.getText(sf)}() under the caller's own claim`;
          }
        } else if (ts.isIdentifier(node.expression) && PASS_THROUGHS.includes(node.expression.text)) {
          const fn = node.expression.text;
          if (fn !== "advisoryCancel" || passesClaim(node.arguments[3])) ending = `${fn}()`;
        }
        if (ending !== undefined) {
          const fn = recorderOf(node);
          const key = `${packageOf(path)}:${fn}`;
          scanned.endings++;
          if (PASS_THROUGHS.includes(fn)) {
            // The helper's own write: its callers are read in its place.
          } else if (key in RECORDERS) {
            recorders[key] = (recorders[key] ?? 0) + 1;
          } else if (!isMarked(lineText(sf, node))) {
            findings.push({ rule: "endings", where: `${path}:${lineOf(sf, node)}`, what: `${ending} in ${key}, which is not a recorder` });
          }
        }
      }
      // A worker flow's door: a `defineFlow` whose config builds a worker's config schema.
      if (doorRule && ts.isCallExpression(node) && node.expression.getText(sf).endsWith("defineFlow") && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
        const config = node.arguments[0];
        const isWorkerFlow = /workerConfigSchema\(|installation\.session\(/.test(config.getText(sf));
        const actions = config.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === "actions");
        if (isWorkerFlow && actions && ts.isObjectLiteralExpression(actions.initializer)) {
          scanned.removedTyped++;
          for (const p of actions.initializer.properties) {
            const key = p.name?.getText(sf).replace(/["']/g, "");
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

  return {
    findings,
    scanned,
    rows,
    tools,
    recorders,
    files: { tracked: tracked.length, swept: swept.length, excluded, program: ownFiles.length },
  };
}
