"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type Mode = "chat" | "create";

interface ModeSelectorProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  disabled?: boolean;
}

export function ModeSelector({ mode, onModeChange, disabled }: ModeSelectorProps) {
  return (
    <Tabs value={mode} onValueChange={(v) => onModeChange(v as Mode)}>
      <TabsList className="h-8">
        <TabsTrigger value="chat" disabled={disabled} className="text-xs">
          Chat
        </TabsTrigger>
        <TabsTrigger value="create" disabled={disabled} className="text-xs">
          Create
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
