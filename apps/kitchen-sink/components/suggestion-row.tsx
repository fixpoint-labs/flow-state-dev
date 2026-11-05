"use client";

import {
  Suggestions,
  Suggestion,
} from "@/components/flow-state/suggestion";
import type { Mode } from "@/components/mode-selector";

/**
 * Lines a person might start with, written for each mode. None names an
 * artifact, a document or anything else a fresh session doesn't have yet.
 */
const SUGGESTIONS: Record<Mode, readonly string[]> = {
  ask: [
    "What can you help me with?",
    "What do you remember about me so far?",
    "How would you handle a billing question?",
  ],
  build: [
    "Create a README for a small command-line tool",
    "Write a deployment plan for a static site",
    "Build a one-page landing page for a bakery",
  ],
  interview: [
    "Interview me about how my team ships releases",
    "Ask me questions until you can describe my project",
    "Help me write down how our on-call works",
  ],
  debate: [
    "Challenge my plan to rewrite our API in Rust",
    "Argue against moving everything to microservices",
    "Stress-test this idea: we should ship every week",
  ],
};

interface SuggestionRowProps {
  /** The mode the composer is in; its chips are that mode's. */
  mode: Mode;
  /** Puts the chip's words in the composer; nothing is sent. */
  onSuggestionClick: (text: string) => void;
  disabled?: boolean;
}

/** The chips over Flow State's composer, for the mode it is in. */
export function SuggestionRow({ mode, onSuggestionClick, disabled }: SuggestionRowProps) {
  return (
    <div className="px-4 py-2">
      <Suggestions>
        {SUGGESTIONS[mode].map((text) => (
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
