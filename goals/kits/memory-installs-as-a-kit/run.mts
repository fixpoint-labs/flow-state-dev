/** Goal check: memory installs as a kit and behaves through a running plain flow. */
import { randomUUID } from 'node:crypto'
import { defineFlow, defineKit, handler } from '@flow-state-dev/core'
import { createFlowState, inMemoryStores, runAction } from '@flow-state-dev/engine'
import { createResponseEmitter } from '@flow-state-dev/engine/host'
import type { Episode, SemanticFact, WorkingMemoryEntry } from '../../../packages/memory/src/index.ts'
import { memory, type MemoryFlowBuilder } from '../../../packages/memory/src/kit/index.ts'
import { runGoal } from '../../lib/index.mts'
import { z } from 'zod'

const writeInput = z.object({ content: z.string() })
const updateInput = z.object({ id: z.string(), content: z.string(), source: z.string() })

const buildFlow: MemoryFlowBuilder = (mem) => {
  const helpers = mem.capability.with({ digest: false, working: false, recall: false })
  const write = handler({
    name: 'memory-kit-write',
    inputSchema: writeInput,
    uses: [helpers],
    execute: async (input, ctx) => {
      await ctx.cap.workingMemory.add({ content: input.content, importance: 1 })
      const episode = await ctx.cap.episodicMemory.encode({
        content: input.content,
        occurredAtTurn: 0,
        significance: 1,
        category: 'identity',
        subject: 'user',
        context: { sessionId: 'goal-turn' },
        durability: 'persistent',
      })
      return ctx.cap.semanticMemory.addFact({
        content: input.content,
        confidence: 1,
        category: 'identity',
        sourceEpisodeIds: [episode.id],
      })
    },
  })
  const read = handler({
    name: 'memory-kit-read',
    uses: [helpers],
    execute: (_input, ctx) => ({
      working: ctx.cap.workingMemory.items().map((entry: WorkingMemoryEntry) => entry.content),
      episodic: ctx.cap.episodicMemory.recent().map((episode: Episode) => episode.content),
      semantic: ctx.cap.semanticMemory.allFacts().map((fact: SemanticFact) => ({ id: fact.id, content: fact.content, sources: fact.sourceEpisodeIds })),
      digest: ctx.cap.digestMemory.get(),
      digestInstalled: mem.regenerateDigest !== undefined,
      janitorInstalled: mem.janitor !== undefined,
    }),
  })
  const update = handler({
    name: 'memory-kit-update',
    inputSchema: updateInput,
    uses: [helpers],
    execute: (input, ctx) => ctx.cap.semanticMemory.updateFact(input.id, input.content, [input.source]),
  })
  return defineFlow({
    kind: 'memory-kit-goal',
    resources: { ...mem.sessionResources, ...mem.userResources },
    actions: { write: { block: write }, read: { block: read }, update: { block: update } },
  })()
}

const stores = { dev: { primary: inMemoryStores() } }
const companion = defineKit({ name: 'memory-goal-companion', install: () => ({ flows: [] }) })
const control = process.env.GOAL_CONTROL
if (control !== undefined && control !== 'without-flow') throw new Error(`unknown GOAL_CONTROL ${control}`)

async function app(scope: 'user' | 'org') {
  const installed = memory({
    model: 'unused/model',
    working: true,
    episodic: { scope },
    semantic: { scope },
    digest: true,
    hygiene: true,
  })
  const state = createFlowState({
    kits: scope === 'user' ? [companion(), installed] : [installed, companion()],
    fill: control === 'without-flow' ? {} : { [memory.slots.flows]: { agent: buildFlow } },
    stores,
  })
  const runtime = await state.getRuntime()
  return { state, runtime, flow: runtime.registry.get('memory-kit-goal')! }
}

type Answer = { working: string[]; episodic: string[]; semantic: Array<{ id: string; content: string; sources: string[] }>; digest?: unknown; digestInstalled: boolean; janitorInstalled: boolean }
async function act(runtime: Awaited<ReturnType<typeof app>>['runtime'], flow: any, actionName: string, input: unknown, userId: string, orgId: string, sessionId: string) {
  const requestId = randomUUID()
  const result = await runAction({ flow, actionName, input, userId, orgId, sessionId, requestId, stores: runtime.stores, runtimeConfig: runtime.runtimeConfig, responseEmitter: createResponseEmitter({ requestId, now: Date.now }) })
  if (result.error) throw new Error(result.error.message)
  return result.output as any
}

await runGoal(async (failures, tell) => {
  const evidence: string[] = []
  try {
    const userApp = await app('user')
    const first = await act(userApp.runtime, userApp.flow, 'write', { content: 'Alice likes tea' }, 'alice', 'acme', 'alice-session-1')
    const sameSession = await act(userApp.runtime, userApp.flow, 'read', {}, 'alice', 'acme', 'alice-session-1') as Answer
    const nextSession = await act(userApp.runtime, userApp.flow, 'read', {}, 'alice', 'acme', 'alice-session-2') as Answer
    const otherUser = await act(userApp.runtime, userApp.flow, 'read', {}, 'bob', 'acme', 'bob-session') as Answer
    tell.over('user working', sameSession.working)
    tell.over('user episodic', nextSession.episodic)
    tell.over('user semantic', nextSession.semantic)
    if (!sameSession.working.includes('Alice likes tea') || nextSession.working.length !== 0) failures.push('working memory did not stay in its session')
    if (!sameSession.digestInstalled || !sameSession.janitorInstalled) failures.push('configured digest or janitor was not installed')
    if (!nextSession.episodic.includes('Alice likes tea') || !nextSession.semantic.some((fact) => fact.content === 'Alice likes tea')) failures.push('user memory did not persist across sessions')
    if (otherUser.episodic.length || otherUser.semantic.length) failures.push('user memory leaked to another user')

    await Promise.all([
      act(userApp.runtime, userApp.flow, 'update', { id: first.id, content: 'Alice likes green tea', source: 'concurrent-a' }, 'alice', 'acme', 'alice-session-3'),
      act(userApp.runtime, userApp.flow, 'update', { id: first.id, content: 'Alice likes black tea', source: 'concurrent-b' }, 'alice', 'acme', 'alice-session-4'),
    ])
    const after = await act(userApp.runtime, userApp.flow, 'read', {}, 'alice', 'acme', 'alice-session-5') as Answer
    const sources = tell.over('CAS provenance', after.semantic.find((fact) => fact.id === first.id)?.sources ?? [])
    if (!sources.includes('concurrent-a') || !sources.includes('concurrent-b')) failures.push(`concurrent CAS writes lost an update: ${JSON.stringify(sources)}`)

    const orgApp = await app('org')
    await act(orgApp.runtime, orgApp.flow, 'write', { content: 'Acme uses purple' }, 'alice', 'acme', 'org-alice')
    const colleague = await act(orgApp.runtime, orgApp.flow, 'read', {}, 'bob', 'acme', 'org-bob') as Answer
    const outsider = await act(orgApp.runtime, orgApp.flow, 'read', {}, 'alice', 'other-org', 'org-other') as Answer
    tell.over('org shared episodic', colleague.episodic)
    tell.over('org shared semantic', colleague.semantic)
    if (!colleague.episodic.includes('Acme uses purple') || !colleague.semantic.some((fact) => fact.content === 'Acme uses purple')) failures.push('org memory was not shared across users in the org')
    if (outsider.episodic.length || outsider.semantic.length) failures.push('org memory leaked to another org')
    evidence.push('plain kit flow installed; session/user/org scopes and concurrent provenance observed; digest and hygiene configured')
    await userApp.state.dispose()
    await orgApp.state.dispose()
  } catch (error) {
    failures.push(`running app failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { failures, evidence: evidence.join('\n') }
})
