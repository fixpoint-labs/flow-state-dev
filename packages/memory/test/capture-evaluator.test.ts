/**
 * Capture with an evaluator in front of the observer.
 *
 * Every turn here runs through `testFlow` on shared stores, so the session log,
 * the watermark and the stores behave as they do in an app: a turn's user
 * message is a real `message` item, and the next turn reads only what the
 * last capture left unread.
 *
 * The claims, and why each matters:
 * - no evaluator → capture is exactly today's pipeline (every app today);
 * - `skip` → the observer never runs and nothing is written, and the turn
 *   counts as read (the evaluator's whole point: an implementation that
 *   ignores the evaluator fails here);
 * - `remember` → the observer reads exactly what the evaluator judged, and
 *   memory is written as without an evaluator;
 * - an evaluator error fails the capture and never falls back to the
 *   observer; the turn stays unread for the next capture;
 * - a capture marks read exactly the messages it judged, even when turns
 *   overlap and land in the log among each other's items (a positional
 *   watermark there marks a failed turn read, or re-reads a skipped one);
 * - memory reads the choice only, never the confidence.
 */
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { boolean, choice, DEFAULT_ORG_ID, defineFlow, evaluator, handler, sequencer } from '@flow-state-dev/core'
import type { EvaluationModel } from '@flow-state-dev/core'
import {
  createMockModelResolver,
  createTestContext,
  mockEvaluationModel,
  mockGenerator,
  testBlock,
  testFlow,
  type MockEvaluationModelOptions,
} from '@flow-state-dev/testing'
import { captureEvaluator, captureQuestions, system } from '../src/index.js'
import type { MemorySystemConfig } from '../src/index.js'
import { CAPTURE_EVALUATOR_NAME } from '../src/capture-evaluator.js'

const USER = 'u1'
/** The user's cell in the org `testFlow` runs under, where user-scoped memory lives. */
const USER_CELL = `${USER}:~org:${DEFAULT_ORG_ID}`
const SESSION = 'session-1'

/** What the mocked observer extracts from every turn it reads: one durable fact. */
const OBSERVED = {
  items: [
    { subject: 'user', content: 'Name is Joe', importance: 0.9, durability: 'permanent', category: 'identity' },
  ],
}

type Answer = 'remember' | 'skip'

/**
 * An evaluation model scripted per call: each call takes the next step. A
 * step is an answer (optionally with a reported confidence) or an error.
 */
function scriptedModel(steps: Array<{ choice: Answer; confidence?: number } | Error>) {
  const calls: Array<{ state: unknown }> = []
  let index = 0
  const model = {
    specificationVersion: 'v4',
    provider: 'mock.evaluation',
    modelId: 'scripted',
    supportedQuestionTypes: ['choice', 'score', 'boolean'],
    calls,
    async doEvaluate(call: { state: unknown }) {
      const step = steps[Math.min(index, steps.length - 1)]
      index += 1
      const options: MockEvaluationModelOptions =
        step instanceof Error
          ? { error: step }
          : { answers: { capture: { type: 'choice', ...step } } }
      calls.push(call)
      return mockEvaluationModel(options).doEvaluate(call as never)
    },
  }
  return model as unknown as EvaluationModel & { calls: Array<{ state: unknown }> }
}

/**
 * An evaluation model for overlapping captures, keyed on the text each call
 * judges. The first call that judges `hold` waits until `release()` (`held`
 * resolves once it is waiting); the first call that judges `fail` then throws;
 * a call that judges `skip` answers skip; every other call answers remember.
 * `calls` holds each judged window as text.
 */
function racingModel(script: { hold: string; fail: string; skip: string }) {
  let signalHeld!: () => void
  const held = new Promise<void>((resolve) => { signalHeld = resolve })
  let release!: () => void
  const released = new Promise<void>((resolve) => { release = resolve })
  const calls: string[] = []
  let holding = false
  let failed = false
  const model = {
    specificationVersion: 'v4',
    provider: 'mock.evaluation',
    modelId: 'racing',
    supportedQuestionTypes: ['choice', 'score', 'boolean'],
    async doEvaluate(call: { state: unknown }) {
      const state = String(call.state)
      calls.push(state)
      if (!holding && state.includes(script.hold)) {
        holding = true
        signalHeld()
        await released
      }
      if (!failed && state.includes(script.fail)) {
        failed = true
        throw new Error('evaluation model unavailable')
      }
      const choice: Answer = state.includes(script.skip) ? 'skip' : 'remember'
      return mockEvaluationModel({ answers: { capture: { type: 'choice', choice } } }).doEvaluate(call as never)
    },
  }
  return Object.assign(model as unknown as EvaluationModel, { calls, held, release })
}

/**
 * A point a mocked model call waits at: `reached` resolves once a call has
 * arrived, and `open()` lets it, and every later call, through.
 */
function callGate() {
  let reach!: () => void
  let open!: () => void
  const reached = new Promise<void>((resolve) => { reach = resolve })
  const opened = new Promise<void>((resolve) => { open = resolve })
  return {
    reached,
    open,
    async pass() {
      reach()
      await opened
    },
  }
}

type TestStores = Awaited<ReturnType<typeof createTestContext>>['stores']

type Overrides = Partial<Pick<MemorySystemConfig, 'evaluator' | 'source'>>

/**
 * A flow that captures each turn on stores shared across turns, the way an
 * app does: capture hangs off the turn as a side chain, so a failed capture
 * fails itself and not the user's turn, and the turn's messages stay in the
 * session log. `say` records the text as the user's message first; `poll`
 * captures with no new message and an empty input, so there is nothing new
 * to read. Pass another harness's `shared` stores to capture the same session
 * under a different memory configuration, as an app does when it changes one,
 * and `historyTurns` to set the flow's history window.
 */
async function harness(
  overrides: Overrides = {},
  { shared, historyTurns }: { shared?: TestStores; historyTurns?: number } = {},
) {
  const mem = system({
    model: 'openai/gpt-5.4-mini',
    working: true,
    episodic: true,
    semantic: true,
    ...overrides,
  })
  const turn = sequencer({ name: 'turn', inputSchema: z.string() }).sideChain(mem.capture)
  // A turn whose only new message is one the client never sees.
  const hiddenTurn = sequencer({ name: 'hidden-turn', inputSchema: z.string() })
    .tap(
      handler({
        name: 'whisper',
        inputSchema: z.string(),
        execute: (text, ctx) => {
          ctx.emit.message(text, { itemVisibility: { client: false } })
        },
      }),
    )
    .sideChain(mem.capture)
  const flow = defineFlow({
    kind: 'capture-evaluator-test',
    actions: {
      say: { block: turn, inputSchema: z.string(), userMessage: (text: string) => text },
      poll: { block: turn, inputSchema: z.string() },
      whisper: { block: hiddenTurn, inputSchema: z.string() },
    },
    resources: { ...mem.sessionResources, ...mem.userResources },
    ...(historyTurns === undefined ? {} : { session: { historyWindow: { turns: historyTurns } } }),
  } as any)()
  const stores = shared ?? (await createTestContext()).stores
  const observer = mockGenerator({
    name: 'memory/observe',
    script: [{ when: () => true, then: { structuredOutput: OBSERVED } }],
  })

  async function run(action: 'say' | 'poll' | 'whisper', input: string) {
    return testFlow({
      flow,
      action,
      input,
      userId: USER,
      sessionId: SESSION,
      stores,
      generators: { 'memory/observe': observer },
    })
  }

  async function read(scope: 'session' | 'user', id: string, key: string): Promise<any> {
    return (await stores.resourceState.get(scope, id, key))?.state
  }

  return {
    observer,
    shared: stores,
    say: (text: string) => run('say', text),
    poll: () => run('poll', ''),
    whisper: (text: string) => run('whisper', text),
    async stores() {
      const working = await read('session', SESSION, 'workingMemory')
      const system = await read('session', SESSION, 'memorySystem')
      const episodic = await read('user', USER_CELL, 'episodicMemory')
      const semantic = await read('user', USER_CELL, 'semanticMemory')
      return {
        entries: working?.entries ?? [],
        currentTurn: working?.currentTurn ?? 0,
        watermark: system?.lastProcessedIndex ?? -1,
        readMessages: system?.readMessages ?? null,
        episodes: episodic?.episodes ?? [],
        facts: semantic?.facts ?? [],
      }
    },
  }
}

/** Names of the blocks that traced in one run, in order. */
function tracedBlocks(items: ReadonlyArray<any>): string[] {
  return items.filter((item) => item.type === 'block_trace').map((item) => item.provenance.blockName)
}

/** The capture's own rows: the traced blocks minus the turn and the semantic tier's background chains. */
function captureRows(items: ReadonlyArray<any>): string[] {
  return tracedBlocks(items).filter(
    (name) => name !== 'turn' && !name.startsWith('memory/consolidate') && !name.startsWith('memory/prune'),
  )
}

/** The error the capture failed with in one run, or `undefined` when it succeeded. */
function captureError(items: ReadonlyArray<any>): { message: string } | undefined {
  const row = items.find((item) => item.type === 'block_trace' && item.provenance.blockName === 'memory/capture')
  return row?.error
}

/** The text the observer was handed in its one call. */
function observerInput(observer: { calls: Array<{ input: unknown }> }, call = 0): string {
  return JSON.stringify(observer.calls[call]?.input)
}

describe('capture with no evaluator (the off path)', () => {
  it('runs today\'s pipeline: observe, reflect, tick, and no evaluator step in the trace', async () => {
    const h = await harness()
    const result = await h.say('My name is Joe')
    expect(result.status).toBe('completed')

    expect(captureError(result.items)).toBeUndefined()
    expect(captureRows(result.items)).toEqual([
      'memory/capture',
      'memory/observe',
      'memory/reflect',
      'memory/tick',
    ])
    expect(result.items.some((item: any) => item.type === 'block_trace' && item.blockKind === 'evaluator')).toBe(false)
    expect(h.observer.calls).toHaveLength(1)

    const after = await h.stores()
    expect(after.entries).toHaveLength(1)
    expect(after.episodes).toHaveLength(1)
    expect(after.facts).toHaveLength(1)
  })
})

describe('capture with an evaluator', () => {
  it('skip: the observer never runs, nothing is added, and the turn counts as read', async () => {
    const model = scriptedModel([{ choice: 'skip' }])
    const h = await harness({ evaluator: captureEvaluator(model) })

    const result = await h.say('ok thanks')
    expect(result.status).toBe('completed')

    // The evaluator was asked, about this turn.
    expect(model.calls).toHaveLength(1)
    expect(String(model.calls[0]!.state)).toContain('ok thanks')

    // The observer never ran, and no working-memory entry, episode or fact
    // was added. The clock tick still advanced the turn counter.
    expect(h.observer.calls).toHaveLength(0)
    const after = await h.stores()
    expect(after.entries).toHaveLength(0)
    expect(after.episodes).toHaveLength(0)
    expect(after.facts).toHaveLength(0)
    expect(after.currentTurn).toBe(1)

    // The turn counts as read: the watermark moved past it, and a capture with
    // nothing new asks the evaluator nothing.
    expect(after.watermark).toBeGreaterThanOrEqual(0)
    const polled = await h.poll()
    expect(polled.status).toBe('completed')
    expect(model.calls).toHaveLength(1)
    expect(h.observer.calls).toHaveLength(0)
  })

  it('a skip never drops the mark of a turn that finished while it was judging', async () => {
    // Turns A and C overlap and both are judged "skip"; A marks read first. C
    // loaded the session's history before A finished, so A is not in C's view
    // of the session. C's mark keeps A's: the next capture reads only turn D.
    // Each turn gets its own millisecond, so A's message is older than all of
    // C's items.
    vi.useFakeTimers({ toFake: ['Date'], now: 1_700_000_000_000 })
    try {
      const gateA = callGate()
      const gateC = callGate()
      const calls: string[] = []
      const model = {
        specificationVersion: 'v4',
        provider: 'mock.evaluation',
        modelId: 'gated',
        supportedQuestionTypes: ['choice', 'score', 'boolean'],
        async doEvaluate(call: { state: unknown }) {
          const state = String(call.state)
          calls.push(state)
          if (state.includes('turn A')) await gateA.pass()
          if (state.includes('turn C')) await gateC.pass()
          const choice: Answer = state.includes('turn D') ? 'remember' : 'skip'
          return mockEvaluationModel({ answers: { capture: { type: 'choice', choice } } }).doEvaluate(call as never)
        },
      } as unknown as EvaluationModel
      const h = await harness({ evaluator: captureEvaluator(model) })

      const first = h.say('small talk, turn A')
      await gateA.reached
      vi.setSystemTime(Date.now() + 1000)
      const second = h.say('more small talk, turn C')
      await gateC.reached
      gateA.open()
      expect(captureError((await first).items)).toBeUndefined()
      gateC.open()
      expect(captureError((await second).items)).toBeUndefined()

      vi.setSystemTime(Date.now() + 1000)
      await h.say('I work at Acme, turn D')
      const lastJudged = calls[calls.length - 1]!
      expect(lastJudged).toContain('turn D')
      expect(lastJudged).not.toContain('turn A')
      expect(lastJudged).not.toContain('turn C')
    } finally {
      vi.useRealTimers()
    }
  })

  it('an app that adds, drops and re-adds its evaluator reads each message once', async () => {
    // A session captured before the app had an evaluator holds only the
    // watermark, and the first capture with one reads past it. Dropping the
    // evaluator hands the session back to the watermark, and adding it again
    // picks up from there.
    const without = await harness()
    const model = scriptedModel([{ choice: 'remember' }])
    const withEvaluator = await harness({ evaluator: captureEvaluator(model) }, { shared: without.shared })

    await without.say('My name is Joe, turn A')
    await withEvaluator.say('I work at Acme, turn B')
    await withEvaluator.say('I live in Leeds, turn C')
    expect(model.calls.map((call) => String(call.state))).toEqual([
      expect.stringMatching(/^(?!.*turn A).*turn B/s),
      expect.stringMatching(/^(?!.*turn [AB]).*turn C/s),
    ])

    await without.say('I like tea, turn D')
    expect(observerInput(without.observer, 1)).toContain('turn D')
    expect(observerInput(without.observer, 1)).not.toContain('turn C')

    await withEvaluator.say('I cycle to work, turn E')
    expect(model.calls[2]!.state).toContain('turn E')
    expect(model.calls[2]!.state).not.toContain('turn D')
  })

  it('keeps a judged message only while the session history still holds it', async () => {
    // Capture reads only the history a turn loads, so what it has judged needs
    // keeping no longer than that; without the bound, the record would grow
    // by every message the session ever had. Each turn gets its own
    // millisecond, so the oldest turn is unambiguous.
    vi.useFakeTimers({ toFake: ['Date'], now: 1_700_000_000_000 })
    try {
      const model = scriptedModel([{ choice: 'skip' }])
      const h = await harness({ evaluator: captureEvaluator(model) }, { historyTurns: 2 })
      for (const turn of ['A', 'B', 'C', 'D']) {
        vi.setSystemTime(Date.now() + 1000)
        await h.say(`small talk, turn ${turn}`)
      }
      // Turn D's capture loads turns B and C: turn A is no longer reachable.
      expect(model.calls).toHaveLength(4)
      expect((await h.stores()).readMessages).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('skip is final: the next turn\'s evaluator and observer read only the new message', async () => {
    const model = scriptedModel([{ choice: 'skip' }, { choice: 'remember' }])
    const h = await harness({ evaluator: captureEvaluator(model) })

    await h.say('ok thanks')
    await h.say('My name is Joe')

    expect(model.calls).toHaveLength(2)
    expect(String(model.calls[1]!.state)).toContain('My name is Joe')
    expect(String(model.calls[1]!.state)).not.toContain('ok thanks')
    expect(h.observer.calls).toHaveLength(1)
    expect(observerInput(h.observer)).not.toContain('ok thanks')
  })

  it('remember: the observer reads exactly what the evaluator judged, and memory is written as without an evaluator', async () => {
    const model = scriptedModel([{ choice: 'remember' }])
    const gated = await harness({ evaluator: captureEvaluator(model) })
    const plain = await harness()

    const result = await gated.say('My name is Joe')
    await plain.say('My name is Joe')
    expect(result.status).toBe('completed')

    expect(model.calls).toHaveLength(1)
    expect(gated.observer.calls).toHaveLength(1)
    const judged = String(model.calls[0]!.state)
    expect(observerInput(gated.observer)).toContain(JSON.stringify(judged).slice(1, -1))
    // Same observer call as with no evaluator at all.
    expect(observerInput(gated.observer)).toBe(observerInput(plain.observer))

    const withEvaluator = await gated.stores()
    const without = await plain.stores()
    expect(withEvaluator.entries.map((e: any) => e.content)).toEqual(without.entries.map((e: any) => e.content))
    expect(withEvaluator.episodes.map((e: any) => e.content)).toEqual(without.episodes.map((e: any) => e.content))
    expect(withEvaluator.facts.map((f: any) => f.content)).toEqual(without.facts.map((f: any) => f.content))
    expect(withEvaluator.currentTurn).toBe(without.currentTurn)
    expect(withEvaluator.entries).toHaveLength(1)
  })

  it('an evaluator error fails the capture, never runs the observer, and leaves the turn unread', async () => {
    const model = scriptedModel([new Error('evaluation model unavailable'), { choice: 'remember' }])
    const h = await harness({ evaluator: captureEvaluator(model) })

    const failed = await h.say('My name is Joe')
    expect(captureError(failed.items)?.message).toContain('evaluation model unavailable')
    expect(h.observer.calls).toHaveLength(0)
    const afterFailure = await h.stores()
    expect(afterFailure.watermark).toBe(-1)
    expect(afterFailure.entries).toHaveLength(0)

    // The next capture's evaluator sees the failed turn as well as the new one.
    const next = await h.say('I work at Acme')
    expect(captureError(next.items)).toBeUndefined()
    expect(model.calls).toHaveLength(2)
    expect(String(model.calls[1]!.state)).toContain('My name is Joe')
    expect(String(model.calls[1]!.state)).toContain('I work at Acme')
    expect(h.observer.calls).toHaveLength(1)
  })

  it('reads the choice only: the same choice with and without confidence gives the same outcome', async () => {
    const outcome = async (step: { choice: Answer; confidence?: number }) => {
      const model = scriptedModel([step])
      const h = await harness({ evaluator: captureEvaluator(model) })
      await h.say('My name is Joe')
      const after = await h.stores()
      return { observed: h.observer.calls.length, entries: after.entries.length, episodes: after.episodes.length }
    }

    expect(await outcome({ choice: 'remember', confidence: 0.99 })).toEqual(await outcome({ choice: 'remember' }))
    expect(await outcome({ choice: 'skip', confidence: 0.97 })).toEqual(await outcome({ choice: 'skip' }))
    // A hesitant skip is still a skip.
    expect(await outcome({ choice: 'skip', confidence: 0.05 })).toEqual({ observed: 0, entries: 0, episodes: 0 })
  })

  it('ignores extra questions on the app\'s evaluator and reads its own answer', async () => {
    const model = mockEvaluationModel({
      answers: {
        capture: { type: 'choice', choice: 'remember' },
        urgent: { type: 'boolean', probability: 0.1 },
      },
    })
    const gate = evaluator({
      name: 'memory-gate',
      model,
      questions: { ...captureQuestions, urgent: boolean('Does this need someone now?') },
    })
    const h = await harness({ evaluator: gate })

    const result = await h.say('My name is Joe')
    expect(result.status).toBe('completed')
    expect(model.calls).toHaveLength(1)
    expect(h.observer.calls).toHaveLength(1)
  })

  it('a source override is what both the evaluator and the observer read, even with new session messages', async () => {
    const model = scriptedModel([{ choice: 'remember' }])
    const h = await harness({
      evaluator: captureEvaluator(model),
      source: () => '[user] text from the source override',
    })

    await h.say('a session message the source overrides')

    expect(model.calls[0]!.state).toBe('[user] text from the source override')
    expect(observerInput(h.observer)).toContain('text from the source override')
    expect(observerInput(h.observer)).not.toContain('a session message the source overrides')
  })

  it('an evaluator without memory\'s question fails the capture with an error naming captureQuestions', async () => {
    const model = mockEvaluationModel({ answers: { team: { type: 'choice', choice: 'billing' } } })
    const gate = evaluator({
      name: 'triage',
      model,
      questions: { team: choice('Which team?', { billing: null, technical: null }) },
    })
    // The type system refuses this block (see the .test-d.ts); a question set
    // computed at run time, or an untyped caller, is not refused until it runs.
    const h = await harness({ evaluator: gate as any })

    const result = await h.say('My name is Joe')
    expect(captureError(result.items)?.message).toContain('captureQuestions')
    expect(h.observer.calls).toHaveLength(0)
    expect((await h.stores()).watermark).toBe(-1)
  })

  it('never writes the judged window to state: no state_change carries it, even a client-hidden message or source text', async () => {
    const hidden = 'client-hidden detail 7f3a'
    for (const choice of ['remember', 'skip'] as const) {
      const model = scriptedModel([{ choice }])
      const h = await harness({ evaluator: captureEvaluator(model) })
      const result = await h.whisper(hidden)
      expect(captureError(result.items)).toBeUndefined()
      // The evaluator did judge the hidden message: it is in the window.
      expect(String(model.calls[0]!.state)).toContain(hidden)
      const leaked = result.items.filter(
        (item: any) => item.type === 'state_change' && JSON.stringify(item).includes(hidden),
      )
      expect(leaked).toEqual([])
    }

    const secret = 'server-only source text 91bc'
    const model = scriptedModel([{ choice: 'remember' }])
    const h = await harness({ evaluator: captureEvaluator(model), source: () => `[user] ${secret}` })
    const result = await h.say('hello')
    expect(model.calls[0]!.state).toBe(`[user] ${secret}`)
    expect(
      result.items.filter((item: any) => item.type === 'state_change' && JSON.stringify(item).includes(secret)),
    ).toEqual([])
  })

  it('a delayed skip racing an evaluator failure never marks the failed turn read', async () => {
    // Two captures of one session overlap. The first is judged "skip" but its
    // answer arrives late; meanwhile the second fails at the evaluator. The
    // skip may mark read only what it judged, so the failed turn stays unread
    // and the next capture's evaluator sees it again.
    //
    // The clock is held still, as on a runner fast enough to put both turns in
    // one millisecond: the session then lists turn C's message among turn B's
    // items rather than after them, so a cursor taken from B's own position
    // in the log would cover it.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const model = racingModel({ hold: 'turn B', fail: 'turn C', skip: 'turn B' })
      const h = await harness({ evaluator: captureEvaluator(model) })

      const first = h.say('small talk, turn B')
      await model.held
      const second = await h.say('My name is Joe, turn C')
      expect(captureError(second.items)?.message).toContain('evaluation model unavailable')
      model.release()
      expect(captureError((await first).items)).toBeUndefined()

      const third = await h.say('I work at Acme, turn D')
      expect(captureError(third.items)).toBeUndefined()
      const lastJudged = model.calls[model.calls.length - 1]!
      expect(lastJudged).toContain('turn D')
      expect(lastJudged).toContain('turn C')
      expect(lastJudged).not.toContain('turn B')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a skip never marks read a turn that was still running when it judged', async () => {
    // Turn B starts first and its evaluator call hangs. Turn C starts, is
    // judged "skip" and finishes; it never saw turn B, which had not finished.
    // Turn B's call then fails, so B stays unread for the next capture, and C,
    // which it did judge, stays read.
    const model = racingModel({ hold: 'turn B', fail: 'turn B', skip: 'turn C' })
    const h = await harness({ evaluator: captureEvaluator(model) })

    const running = h.say('My name is Joe, turn B')
    await model.held
    const skipped = await h.say('small talk, turn C')
    expect(captureError(skipped.items)).toBeUndefined()
    model.release()
    expect(captureError((await running).items)?.message).toContain('evaluation model unavailable')

    const next = await h.say('I work at Acme, turn D')
    expect(captureError(next.items)).toBeUndefined()
    const lastJudged = model.calls[model.calls.length - 1]!
    expect(lastJudged).toContain('turn D')
    expect(lastJudged).toContain('turn B')
    expect(lastJudged).not.toContain('turn C')
  })

  it('refuses, when built, a block of another kind in the evaluator slot', () => {
    const impostor = handler({
      name: 'always-remember',
      inputSchema: z.string(),
      execute: () => ({ answers: { capture: { type: 'choice' as const, choice: 'remember' as const } } }),
    })
    expect(() => system({ model: 'openai/gpt-5.4-mini', working: true, evaluator: impostor as any })).toThrow(
      'memory system: "evaluator" must be an evaluator block (got handler "always-remember"). ' +
        "Build one with captureEvaluator(model), or core's evaluator() with captureQuestions.",
    )
  })

  it('a skipped turn\'s trace shows the evaluator\'s answer and no observer row', async () => {
    const model = scriptedModel([{ choice: 'skip' }])
    const h = await harness({ evaluator: captureEvaluator(model) })

    const result = await h.say('ok thanks')

    const evaluatorRow = result.items.find(
      (item: any) => item.type === 'block_trace' && item.provenance.blockName === CAPTURE_EVALUATOR_NAME,
    ) as any
    expect(evaluatorRow).toBeDefined()
    expect(evaluatorRow.output).toMatchObject({ value: { answers: { capture: { type: 'choice', choice: 'skip' } } } })
    expect(tracedBlocks(result.items)).not.toContain('memory/observe')
    expect(tracedBlocks(result.items)).not.toContain('memory/reflect')
  })
})

describe('captureEvaluator(model)', () => {
  it('builds core\'s evaluator block on memory\'s question and the model as given', () => {
    const model = mockEvaluationModel()
    for (const m of ['typesafe-ai/jev', model] as const) {
      const block = captureEvaluator(m)
      expect(block.kind).toBe('evaluator')
      expect(block.name).toBe(CAPTURE_EVALUATOR_NAME)
      expect((block.config as any).questions).toBe(captureQuestions)
      expect((block.config as any).model).toBe(m)
    }
  })

  it('resolves nothing when built: core resolves a model string, through the app\'s resolver, when the block runs', async () => {
    const resolved: string[] = []
    const modelResolver = Object.assign(createMockModelResolver({}), {
      resolveEvaluationModel(modelId: string) {
        resolved.push(modelId)
        return mockEvaluationModel({ answers: { capture: { type: 'choice', choice: 'skip' } } })
      },
    })

    const block = captureEvaluator('typesafe-ai/jev')
    expect(resolved).toEqual([])

    const result = await testBlock(block, { input: '[user] ok thanks', modelResolver })
    expect(result.error).toBeNull()
    expect(resolved).toEqual(['typesafe-ai/jev'])
    expect(result.output).toMatchObject({ answers: { capture: { choice: 'skip' } } })
  })

  it('drives capture the same as the same block built by hand', async () => {
    const outcome = async (build: (model: EvaluationModel) => MemorySystemConfig['evaluator']) => {
      const out: Record<Answer, { observed: number; entries: number }> = {} as any
      for (const choice of ['remember', 'skip'] as const) {
        const model = scriptedModel([{ choice }])
        const h = await harness({ evaluator: build(model) })
        await h.say('My name is Joe')
        out[choice] = { observed: h.observer.calls.length, entries: (await h.stores()).entries.length }
      }
      return out
    }

    const viaHelper = await outcome((model) => captureEvaluator(model))
    const byHand = await outcome((model) => evaluator({ name: 'by-hand', model, questions: captureQuestions }))
    expect(viaHelper).toEqual(byHand)
    expect(viaHelper).toEqual({ remember: { observed: 1, entries: 1 }, skip: { observed: 0, entries: 0 } })
  })
})
