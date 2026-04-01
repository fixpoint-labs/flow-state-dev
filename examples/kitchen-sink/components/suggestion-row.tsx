"use client";

import {
  Suggestions,
  Suggestion,
} from "@/components/flow-state/suggestion";

const SUGGESTIONS = [
  "Summarize the current project context",
  "Create a deployment plan",
  "Create a new README artifact",
  "Read artifact doc-1",
];

interface SuggestionRowProps {
  onSuggestionClick: (text: string) => void;
  disabled?: boolean;
}

export function SuggestionRow({ onSuggestionClick, disabled }: SuggestionRowProps) {
  return (
    <div className="px-4 py-2">
      <Suggestions>
        {SUGGESTIONS.map((text) => (
          <Suggestion
            key={text}
            suggestion={text}
            onClick={onSuggestionClick}
            disabled={disabled}
          />
        ))}
      </Suggestions>
    </div>
  );
}
