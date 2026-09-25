/**
 * Memory's fence around evaluation models.
 *
 * Memory takes a finished evaluator block from the app and never reaches a
 * model itself: it depends on core alone, imports no provider SDK, no Jev and
 * no lab, and names no `provider/model` id in its source. The app picks the
 * model; core resolves it when the block runs.
 *
 * The check runs over the real package, and each rule has a planted
 * violation beside it that must trip it, so a scanner that stopped reading
 * files would fail here rather than pass quietly.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageDir = join(__dirname, '..')
const srcDir = join(packageDir, 'src')

/** The only runtime dependencies memory has. */
const ALLOWED_DEPENDENCIES = ['@flow-state-dev/core', 'zod']

/** Module specifiers memory never imports: provider SDKs, the AI SDK itself, Jev, labs. */
const FORBIDDEN_IMPORT = /^(?:ai$|@ai-sdk\/|@openrouter\/|@typesafe-ai\/|typesafe-ai|jev|@flow-state-dev\/(?!core(?:\/|$))|.*\blabs?\b)/

/** A quoted `provider/model` id for a provider that serves models. */
const MODEL_ID =
  /['"`](?:openai|anthropic|typesafe-ai|google|vertex|azure|bedrock|xai|mistral|groq|deepseek|cohere|openrouter|perplexity|fireworks|togetherai)\/[\w.:-]+['"`]/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : []
  })
}

/** Drop comments so a documentation example is not read as code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const pattern = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const match of source.matchAll(pattern)) specifiers.push(match[1] ?? match[2] ?? match[3]!)
  return specifiers
}

/** Every rule the fence enforces, over a package manifest and its source files. */
function violations(pkg: { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> }, files: Record<string, string>): string[] {
  const found: string[] = []
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })) {
    if (!ALLOWED_DEPENDENCIES.includes(dep)) found.push(`dependency ${dep}`)
  }
  for (const [file, raw] of Object.entries(files)) {
    const source = stripComments(raw)
    for (const specifier of importSpecifiers(source)) {
      if (!specifier.startsWith('.') && FORBIDDEN_IMPORT.test(specifier)) found.push(`${file} imports ${specifier}`)
    }
    const id = source.match(MODEL_ID)
    if (id) found.push(`${file} names model ${id[0]}`)
  }
  return found
}

const realPackage = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
const realFiles = Object.fromEntries(
  sourceFiles(srcDir).map((path) => [relative(packageDir, path), readFileSync(path, 'utf8')]),
)

describe('memory reaches no evaluation model', () => {
  it('reads the real source', () => {
    // Guards the scan itself: an empty walk would pass every rule below.
    expect(Object.keys(realFiles)).toContain('src/capture-evaluator.ts')
    expect(importSpecifiers(stripComments(realFiles['src/capture-evaluator.ts']!))).toContain('@flow-state-dev/core')
  })

  it('depends on core alone, imports no provider, Jev or lab, and names no model id', () => {
    expect(violations(realPackage, realFiles)).toEqual([])
  })

  it('trips on a planted provider import', () => {
    const planted = { ...realFiles, 'src/planted.ts': "import { openai } from '@ai-sdk/openai'\n" }
    expect(violations(realPackage, planted)).toEqual(['src/planted.ts imports @ai-sdk/openai'])
  })

  it('trips on a planted Jev import and a planted sibling package import', () => {
    const planted = {
      'src/a.ts': "import { typeSafeAi } from '@typesafe-ai/provider'\n",
      'src/b.ts': "export { x } from '@flow-state-dev/engine'\n",
    }
    expect(violations({}, planted)).toEqual([
      'src/a.ts imports @typesafe-ai/provider',
      'src/b.ts imports @flow-state-dev/engine',
    ])
  })

  it('trips on a planted model id, and not on one inside a comment', () => {
    const planted = {
      'src/a.ts': "const model = 'typesafe-ai/jev'\n",
      'src/b.ts': "/** e.g. captureEvaluator('typesafe-ai/jev') */\nexport const x = 1\n",
    }
    expect(violations({}, planted)).toEqual(["src/a.ts names model 'typesafe-ai/jev'"])
  })

  it('trips on a planted dependency', () => {
    const planted = { ...realPackage, dependencies: { ...realPackage.dependencies, '@ai-sdk/openai': '^1.0.0' } }
    expect(violations(planted, {})).toEqual(['dependency @ai-sdk/openai'])
  })
})
