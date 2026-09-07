/**
 * Workforce POC lab E — write and read goals / lessons at the scopes
 * today's APIs actually have. Zero-model. Two flow kinds share the same
 * resource objects so isolation is the storage key, not a second store.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { orgLessons, seatMemory, teamDocs, userGoals } from "./resources";

const nonBlank = (s: string) => s.trim().length > 0;

const bodySchema = z.object({
  body: z.string().refine(nonBlank, "body must be non-blank"),
});

const readSchema = z.object({
  body: z.string().nullable(),
});

const teamKeySchema = z.object({
  rosterId: z.string().min(1),
  doc: z.string().min(1),
});

const writeUserGoals = handler({
  name: "writeUserGoals",
  inputSchema: bodySchema,
  outputSchema: z.object({ written: z.literal(true) }),
  resources: { userGoals },
  execute: async (input, ctx) => {
    await ctx.resources.userGoals.writeContent(input.body);
    return { written: true as const };
  },
});

const readUserGoals = handler({
  name: "readUserGoals",
  inputSchema: z.object({}),
  outputSchema: readSchema,
  resources: { userGoals },
  execute: async (_input, ctx) => ({
    body: await ctx.resources.userGoals.readContent(),
  }),
});

const writeOrgLessons = handler({
  name: "writeOrgLessons",
  inputSchema: bodySchema,
  outputSchema: z.object({ written: z.literal(true) }),
  resources: { orgLessons },
  execute: async (input, ctx) => {
    await ctx.resources.orgLessons.writeContent(input.body);
    return { written: true as const };
  },
});

const readOrgLessons = handler({
  name: "readOrgLessons",
  inputSchema: z.object({}),
  outputSchema: readSchema,
  resources: { orgLessons },
  execute: async (_input, ctx) => ({
    body: await ctx.resources.orgLessons.readContent(),
  }),
});

const writeTeamDoc = handler({
  name: "writeTeamDoc",
  inputSchema: teamKeySchema.extend({
    body: z.string().refine(nonBlank, "body must be non-blank"),
  }),
  outputSchema: z.object({ written: z.literal(true), key: z.string() }),
  resources: { teamDocs },
  execute: async (input, ctx) => {
    const key = { rosterId: input.rosterId, doc: input.doc };
    const ref = await ctx.resources.teamDocs.getOrCreate(key);
    await ref.writeContent(input.body);
    return { written: true as const, key: ref.path };
  },
});

const readTeamDoc = handler({
  name: "readTeamDoc",
  inputSchema: teamKeySchema,
  outputSchema: readSchema,
  resources: { teamDocs },
  execute: async (input, ctx) => {
    const ref = await ctx.resources.teamDocs.getOptional({
      rosterId: input.rosterId,
      doc: input.doc,
    });
    return { body: ref === undefined ? null : await ref.readContent() };
  },
});

const writeSeatMemory = handler({
  name: "writeSeatMemory",
  inputSchema: bodySchema,
  outputSchema: z.object({ written: z.literal(true) }),
  resources: { seatMemory },
  execute: async (input, ctx) => {
    await ctx.resources.seatMemory.writeContent(input.body);
    return { written: true as const };
  },
});

const readSeatMemory = handler({
  name: "readSeatMemory",
  inputSchema: z.object({}),
  outputSchema: readSchema,
  resources: { seatMemory },
  execute: async (_input, ctx) => ({
    body: await ctx.resources.seatMemory.readContent(),
  }),
});

const actions = {
  writeUserGoals: {
    block: writeUserGoals,
    description: "Write user-private goals as resource content.",
  },
  readUserGoals: {
    block: readUserGoals,
    description: "Read user-private goals.",
  },
  writeOrgLessons: {
    block: writeOrgLessons,
    description: "Write org-wide lessons as resource content.",
  },
  readOrgLessons: {
    block: readOrgLessons,
    description: "Read org-wide lessons.",
  },
  writeTeamDoc: {
    block: writeTeamDoc,
    description: "Write a roster-keyed org collection instance (goals / lessons).",
  },
  readTeamDoc: {
    block: readTeamDoc,
    description: "Read a roster-keyed org collection instance.",
  },
  writeSeatMemory: {
    block: writeSeatMemory,
    description: "Write flow-isolated user content (member-identity proof).",
  },
  readSeatMemory: {
    block: readSeatMemory,
    description: "Read flow-isolated user content.",
  },
};

function makeFlow(kind: string) {
  return defineFlow({
    kind,
    authentication: { requireUser: true },
    resources: { userGoals, orgLessons, teamDocs, seatMemory },
    actions,
  })({ id: "default" });
}

/** Primary worker kind. Atlas's "eng-manager" stand-in. */
export const workforcePocEFlow = makeFlow("workforce-poc-e");

/** Second worker kind. Same resource objects, different flowKind. */
export const otherKindFlow = makeFlow("workforce-poc-e-other");

export default workforcePocEFlow;
