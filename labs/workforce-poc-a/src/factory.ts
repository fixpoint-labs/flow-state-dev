/**
 * Lab-local worker factory — L2 convention on today's `defineFlow`.
 *
 * Not an `@flow-state-dev/workforce` export. That package materializes a
 * generator; this emits a flow. The Atlas lock is the shape, not a shipped API.
 */
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import {
  defineFlow,
  defineResource,
  dispatcher,
  handler,
  sequencer
} from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";

export const sessionStateSchema = z.object({
  lastTalk: z.string().nullable().default(null),
  lastWake: z
    .object({
      postId: z.string(),
      body: z.string(),
      fromSessionId: z.string()
    })
    .nullable()
    .default(null)
});

export const boardStateSchema = z.object({
  subscribers: z.array(z.string()).default([]),
  posts: z
    .array(
      z.object({
        id: z.string(),
        body: z.string(),
        fromSessionId: z.string()
      })
    )
    .default([])
});

export const memoryStateSchema = z.object({
  role: z.string(),
  personality: z.string(),
  tools: z.array(z.string()),
  skills: z.array(z.string())
});

const wakeInputSchema = z.object({
  sessionId: z.string(),
  postId: z.string(),
  body: z.string(),
  fromSessionId: z.string()
});

export interface WorkerConfig {
  /** Flow kind and worker name — one flow per worker. */
  name: string;
  role: string;
  personality: string;
  tools: readonly string[];
  skills: readonly string[];
}

export interface WorkerFolder {
  /** Directory whose basename is the worker name. */
  dir: string;
}

/** Read the proposed file convention into a config. Files configure; they do not run. */
export function readWorkerFolder(dir: string): WorkerConfig {
  const name = basename(dir);
  const toolsRaw = readFileSync(join(dir, "tools.md"), "utf8");
  const skillsDir = join(dir, "skills");
  const skills = readdirSync(skillsDir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.replace(/\.md$/, ""));
  return {
    name,
    role: readFileSync(join(dir, "role.md"), "utf8").trim(),
    personality: readFileSync(join(dir, "personality.md"), "utf8").trim(),
    tools: toolsRaw
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")),
    skills
  };
}

/**
 * Emit one worker flow of the contract shape.
 *
 * Public: talk (DM), subscribe, post (group fan-out), deliver (one hop), whoami.
 * Internal: receive — the only entry `dispatcher()` wakes.
 */
export function createWorkerFlow(config: WorkerConfig): FlowInstance {
  const memory = defineResource({
    scope: "user",
    ref: "worker-memory",
    flowIsolation: true,
    writable: true,
    stateSchema: memoryStateSchema,
    default: {
      role: config.role,
      personality: config.personality,
      tools: [...config.tools],
      skills: [...config.skills]
    }
  });

  const board = defineResource({
    scope: "user",
    ref: "group-board",
    flowIsolation: true,
    writable: true,
    stateSchema: boardStateSchema,
    default: { subscribers: [], posts: [] }
  });

  const whoami = handler({
    name: `${config.name}-whoami`,
    inputSchema: z.object({}),
    outputSchema: z.object({
      kind: z.string(),
      role: z.string(),
      personality: z.string(),
      tools: z.array(z.string()),
      skills: z.array(z.string())
    }),
    resources: { memory },
    execute: async (_input, ctx) => {
      const mem = ctx.resources.memory.state;
      return {
        kind: config.name,
        role: mem.role || config.role,
        personality: mem.personality || config.personality,
        tools: mem.tools.length > 0 ? mem.tools : [...config.tools],
        skills: mem.skills.length > 0 ? mem.skills : [...config.skills]
      };
    }
  });

  const talk = handler({
    name: `${config.name}-talk`,
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.object({ sessionId: z.string(), heard: z.string() }),
    sessionStateSchema,
    execute: async (input, ctx) => {
      await ctx.session.patchState({ lastTalk: input.message });
      return { sessionId: ctx.session.identity.id, heard: input.message };
    }
  });

  const subscribe = handler({
    name: `${config.name}-subscribe`,
    inputSchema: z.object({}),
    outputSchema: z.object({
      sessionId: z.string(),
      subscribers: z.array(z.string())
    }),
    resources: { board },
    execute: async (_input, ctx) => {
      const sessionId = ctx.session.identity.id;
      const current = ctx.resources.board.state;
      const subscribers = current.subscribers.includes(sessionId)
        ? current.subscribers
        : [...current.subscribers, sessionId];
      if (subscribers !== current.subscribers) {
        await ctx.resources.board.patchState({ ...current, subscribers });
      }
      return { sessionId, subscribers };
    }
  });

  const receive = handler({
    name: `${config.name}-receive`,
    inputSchema: z.object({
      postId: z.string(),
      body: z.string(),
      fromSessionId: z.string()
    }),
    outputSchema: z.object({ sessionId: z.string() }),
    sessionStateSchema,
    execute: async (input, ctx) => {
      await ctx.session.patchState({ lastWake: input });
      return { sessionId: ctx.session.identity.id };
    }
  });

  const deliver = dispatcher({
    name: `${config.name}-deliver`,
    type: "internal",
    target: "receive",
    inputSchema: wakeInputSchema,
    session: { id: (input) => input.sessionId },
    payload: (input) => ({
      postId: input.postId,
      body: input.body,
      fromSessionId: input.fromSessionId
    })
  });

  const recordPost = handler({
    name: `${config.name}-record-post`,
    inputSchema: z.object({ body: z.string() }),
    outputSchema: z.object({
      postId: z.string(),
      body: z.string(),
      fromSessionId: z.string(),
      wakes: z.array(wakeInputSchema)
    }),
    resources: { board },
    sessionStateSchema,
    execute: async (input, ctx) => {
      const fromSessionId = ctx.session.identity.id;
      const postId = `post_${ctx.request.identity.id}`;
      const current = ctx.resources.board.state;
      await ctx.resources.board.patchState({
        ...current,
        posts: [...current.posts, { id: postId, body: input.body, fromSessionId }]
      });
      return {
        postId,
        body: input.body,
        fromSessionId,
        wakes: current.subscribers.map((sessionId) => ({
          sessionId,
          postId,
          body: input.body,
          fromSessionId
        }))
      };
    }
  });

  const post = sequencer({
    name: `${config.name}-post`,
    inputSchema: z.object({ body: z.string() })
  })
    .step(recordPost)
    .forEach((out) => out.wakes, deliver);

  return defineFlow({
    kind: config.name,
    session: { stateSchema: sessionStateSchema },
    resources: { board, memory },
    actions: {
      whoami: { block: whoami },
      talk: { block: talk },
      subscribe: { block: subscribe },
      post: { block: post },
      deliver: { block: deliver }
    },
    internal: {
      actions: {
        receive: { block: receive }
      }
    }
  })({ id: config.name });
}

export function createWorkerFlowFromFolder(dir: string): FlowInstance {
  return createWorkerFlow(readWorkerFolder(dir));
}
