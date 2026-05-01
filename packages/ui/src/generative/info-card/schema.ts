/**
 * Info-card schema. Same Zod object backs both the LLM tool's input schema and
 * the renderer's data contract — consumers should never duplicate this shape.
 */
import { z } from "zod";

export const InfoCardSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe(
      "Stable id for this card. Use a slug or short content hash so re-emissions replace prior versions in place."
    ),
  title: z.string().min(1).describe("Card title. Short and concrete."),
  subtitle: z.string().optional().describe("Optional one-line subtitle."),
  imageUrl: z
    .string()
    .url()
    .optional()
    .describe("Optional hero image URL. Skip when no image is genuinely useful."),
  facts: z
    .array(
      z.object({
        label: z.string().min(1),
        value: z.string().min(1),
      })
    )
    .max(8)
    .describe("Up to 8 label/value rows. Keep values terse — short phrases, not sentences."),
  footer: z
    .string()
    .optional()
    .describe("Optional small-print footer (citation, last-updated, etc.)."),
});

export type InfoCardData = z.infer<typeof InfoCardSchema>;
