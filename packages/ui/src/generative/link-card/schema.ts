/**
 * Link-card schema. Replaces a bare URL in chat with a previewable card.
 * Same Zod object backs the LLM tool's input schema and the renderer's data.
 */
import { z } from "zod";

export const LinkCardSchema = z.object({
  url: z.string().url().describe("The destination URL. Must be absolute."),
  title: z.string().min(1).describe("Page title or short heading describing the link target."),
  description: z
    .string()
    .optional()
    .describe("One- or two-sentence summary of what the user will find at the URL."),
  siteName: z
    .string()
    .optional()
    .describe("Source / publisher name, e.g. 'Wikipedia', 'GitHub', 'NYT'."),
  imageUrl: z
    .string()
    .url()
    .optional()
    .describe("Optional preview image / og:image URL."),
  favicon: z
    .string()
    .url()
    .optional()
    .describe("Optional favicon URL for the source site."),
});

export type LinkCardData = z.infer<typeof LinkCardSchema>;
