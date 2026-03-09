"use client";

import { type VoiceState } from "@flow-state-dev/react";

type VoiceToggleProps = {
  voice: VoiceState;
  disabled?: boolean;
  ttsEnabled?: boolean;
  onToggleTTS?: () => void;
};

export function VoiceToggle({ voice, disabled, ttsEnabled, onToggleTTS }: VoiceToggleProps) {
  if (!voice.isAvailable) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      {/* Push-to-talk mic button */}
      <button
        type="button"
        disabled={disabled || voice.isProcessing}
        className={`
          inline-flex items-center justify-center rounded-full w-9 h-9 text-sm font-medium
          transition-colors focus-visible:outline-none focus-visible:ring-2
          ${voice.isListening
            ? "bg-red-500 text-white hover:bg-red-600 animate-pulse"
            : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          }
          disabled:pointer-events-none disabled:opacity-50
        `}
        onMouseDown={() => void voice.startListening()}
        onMouseUp={() => void voice.stopListening()}
        onMouseLeave={() => {
          if (voice.isListening) void voice.stopListening();
        }}
        onTouchStart={() => void voice.startListening()}
        onTouchEnd={() => void voice.stopListening()}
        title={voice.isListening ? "Release to send" : "Hold to speak"}
      >
        {voice.isProcessing ? (
          <ProcessingIcon />
        ) : voice.isListening ? (
          <MicOnIcon />
        ) : (
          <MicOffIcon />
        )}
      </button>

      {/* TTS toggle */}
      {onToggleTTS && (
        <button
          type="button"
          disabled={disabled}
          onClick={onToggleTTS}
          className={`
            inline-flex items-center justify-center rounded-full w-9 h-9 text-sm font-medium
            transition-colors focus-visible:outline-none focus-visible:ring-2
            ${ttsEnabled
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }
            disabled:pointer-events-none disabled:opacity-50
          `}
          title={ttsEnabled ? "Disable voice responses" : "Enable voice responses"}
        >
          {ttsEnabled ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
        </button>
      )}

      {/* Stop speaking button */}
      {voice.isSpeaking && (
        <button
          type="button"
          onClick={() => voice.stopSpeaking()}
          className="inline-flex items-center justify-center rounded-full w-7 h-7 text-xs bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          title="Stop speaking"
        >
          <StopIcon />
        </button>
      )}

      {voice.interimTranscript && (
        <span className="text-xs text-muted-foreground italic max-w-[200px] truncate">
          {voice.interimTranscript}
        </span>
      )}

      {voice.isProcessing && (
        <span className="text-xs text-muted-foreground">
          Transcribing...
        </span>
      )}
    </div>
  );
}

function MicOnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

function SpeakerOnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function SpeakerOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="22" x2="16" y1="9" y2="15" />
      <line x1="16" x2="22" y1="9" y2="15" />
    </svg>
  );
}

function ProcessingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  );
}
