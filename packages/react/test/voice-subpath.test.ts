/**
 * The voice primitives live on `@flow-state-dev/react/voice`, not on the
 * root.
 *
 * The root is what a chat-app author autocompletes, and `useVoice` is all a
 * chat app needs, so it stays there. The recorder, player and speech
 * primitives `useVoice` drives are for an app that builds its own voice loop,
 * so they sit on a subpath instead of leaving public surface. Each name has
 * one path: `useVoice` is not on `/voice`, and none of the primitives is on
 * the root. The published manifest must serve the subpath too, or it works in
 * this repo and fails for an adopter.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as voice from "../src/voice";
import type {
  AudioPlayer,
  AudioPlayerCallbacks,
  AudioPlayerStatus,
  AudioRecorder,
  AudioRecorderOptions,
  AudioRecorderStatus,
  SpeechRecognitionCallbacks,
  SpeechRecognitionHandle
} from "../src/voice";
import * as root from "../src";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const manifest = JSON.parse(readFileSync(here("../package.json"), "utf8")) as {
  exports: Record<string, { types: string; default: string }>;
  publishConfig: { exports: Record<string, { types: string; default: string }> };
};

const VALUES = ["createAudioPlayer", "createAudioRecorder", "createSpeechRecognition", "isSpeechRecognitionAvailable"];
const TYPES = [
  "AudioPlayer",
  "AudioPlayerCallbacks",
  "AudioPlayerStatus",
  "AudioRecorder",
  "AudioRecorderOptions",
  "AudioRecorderStatus",
  "SpeechRecognitionCallbacks",
  "SpeechRecognitionHandle"
];

/**
 * Names each type so `pnpm typecheck` (which compiles this file) fails when
 * `/voice` stops exporting one: a type leaves no runtime key to assert on.
 */
type VoiceTypes = [
  AudioPlayer,
  AudioPlayerCallbacks,
  AudioPlayerStatus,
  AudioRecorder,
  AudioRecorderOptions,
  AudioRecorderStatus,
  SpeechRecognitionCallbacks,
  SpeechRecognitionHandle
];

describe("@flow-state-dev/react/voice", () => {
  it("carries exactly the voice primitives, and not useVoice", () => {
    expect(Object.keys(voice).sort()).toEqual(VALUES);
    const source = readFileSync(here("../src/voice/index.ts"), "utf8");
    expect(TYPES.filter((name) => !new RegExp(`\\btype ${name}\\b`).test(source))).toEqual([]);
    const typed: VoiceTypes["length"] = 8;
    expect(typed).toBe(TYPES.length);
  });

  it("is served by the package in the workspace and once published", () => {
    expect(manifest.exports["./voice"]).toEqual({
      types: "./dist/voice/index.d.ts",
      default: "./src/voice/index.ts"
    });
    expect(manifest.publishConfig.exports["./voice"]).toEqual({
      types: "./dist/voice/index.d.ts",
      default: "./dist/voice/index.js"
    });
    expect(existsSync(here("../src/voice/index.ts"))).toBe(true);
  });

  it("leaves none of the primitives on the root, which keeps useVoice", () => {
    // Runtime names are checked on the module; type-only names leave no
    // runtime trace, so the root's source is read for every name too.
    expect(Object.keys(root).filter((name) => VALUES.includes(name))).toEqual([]);
    const source = readFileSync(here("../src/index.ts"), "utf8");
    expect([...VALUES, ...TYPES].filter((name) => new RegExp(`\\b${name}\\b`).test(source))).toEqual([]);
    expect(typeof root.useVoice).toBe("function");
  });
});
