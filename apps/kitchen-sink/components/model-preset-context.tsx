"use client";

import { createContext, useContext } from "react";

const ModelPresetContext = createContext<string>("preset/small");

export const ModelPresetProvider = ModelPresetContext.Provider;

export function useModelPreset(): string {
  return useContext(ModelPresetContext);
}
