import { gateway } from "ai";
import type { ModelResolver } from "../types";
import { createAiSdkModelResolver } from "./createAiSdkModelResolver";

function toGatewayModelId(modelId: string): string {
  const trimmed = modelId.trim();
  if (trimmed.length === 0) {
    throw new Error("Model id cannot be empty");
  }

  if (trimmed.includes("/")) {
    return trimmed;
  }

  const separatorIndex = trimmed.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    return trimmed;
  }

  return `${trimmed.slice(0, separatorIndex)}/${trimmed.slice(separatorIndex + 1)}`;
}

/**
 * Creates the default production model resolver backed by Vercel AI Gateway.
 * Accepts model ids in either `provider:model` or `provider/model` format.
 */
export function createDefaultModelResolver(): ModelResolver {
  return createAiSdkModelResolver((modelId) =>
    gateway.languageModel(toGatewayModelId(modelId))
  );
}
