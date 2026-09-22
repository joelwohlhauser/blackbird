import type { TextToSpeechSpeed } from "@t3tools/contracts/settings";
import { create } from "zustand";

import { toastManager } from "~/components/ui/toast";

const GEMINI_TTS_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:streamGenerateContent?alt=sse";
const PCM_SAMPLE_RATE = 24_000;
const MAX_CACHED_CLIPS = 20;

export const useTextToSpeechStore = create<{
  playback: {
    readonly messageId: string;
    readonly status: "loading" | "playing";
    readonly speed: TextToSpeechSpeed;
  } | null;
}>(() => ({ playback: null }));

let active: { audio: HTMLAudioElement; abort: AbortController } | null = null;
const clipUrls = new Map<string, string>();

export function stopTextToSpeech() {
  if (active) {
    active.abort.abort();
    active.audio.pause();
    active = null;
  }
  useTextToSpeechStore.setState({ playback: null });
}

export function setTextToSpeechSpeed(speed: TextToSpeechSpeed) {
  const playback = useTextToSpeechStore.getState().playback;
  if (!active || !playback) return;
  active.audio.playbackRate = speed;
  useTextToSpeechStore.setState({ playback: { ...playback, speed } });
}

export async function playTextToSpeech(input: {
  messageId: string;
  markdown: string;
  apiKey: string;
  voice: string;
  speed: TextToSpeechSpeed;
}) {
  stopTextToSpeech();
  const audio = new Audio();
  audio.defaultPlaybackRate = input.speed;
  const abort = new AbortController();
  const session = { audio, abort };
  active = session;
  const isActive = () => active === session;
  useTextToSpeechStore.setState({
    playback: { messageId: input.messageId, status: "loading", speed: input.speed },
  });
  audio.addEventListener("playing", () => {
    const playback = useTextToSpeechStore.getState().playback;
    if (isActive() && playback?.status === "loading") {
      useTextToSpeechStore.setState({ playback: { ...playback, status: "playing" } });
    }
  });
  audio.addEventListener("ended", () => {
    if (isActive()) stopTextToSpeech();
  });

  const cacheKey = `${input.voice}:${input.messageId}`;
  try {
    let url = clipUrls.get(cacheKey);
    if (!url) {
      url = URL.createObjectURL(pcmToWav(await fetchSpeech(input, abort.signal)));
      cacheClip(cacheKey, url);
    }
    if (!isActive()) return;
    audio.src = url;
    await audio.play();
  } catch (error) {
    if (!isActive()) return;
    stopTextToSpeech();
    toastManager.add({
      type: "error",
      title: "Could not read message aloud",
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

interface GeminiSpeechResponse {
  readonly candidates?: ReadonlyArray<{
    readonly content?: {
      readonly parts?: ReadonlyArray<{ readonly inlineData?: { readonly data?: string } }>;
    };
  }>;
  readonly error?: { readonly message?: string };
}

async function fetchSpeech(
  input: { markdown: string; apiKey: string; voice: string },
  signal: AbortSignal,
) {
  const response = await fetch(GEMINI_TTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": input.apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: markdownToSpeechText(input.markdown) }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voice } } },
      },
    }),
    signal,
  });
  if (!response.ok || !response.body) {
    const body: GeminiSpeechResponse | null = await response.json().catch(() => null);
    throw new Error(body?.error?.message?.trim() || `Gemini responded with ${response.status}`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const chunks: Int16Array<ArrayBuffer>[] = [];
  let unparsed = "";
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    const lines = (unparsed + read.value).split("\n");
    unparsed = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const event: GeminiSpeechResponse = JSON.parse(line.slice(5));
      const data = event.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (data) chunks.push(decodePcm(data));
    }
  }
  if (chunks.length === 0) throw new Error("Gemini returned no audio");
  return concatPcm(chunks);
}

function decodePcm(base64: string) {
  return new Int16Array(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)).buffer);
}

function concatPcm(parts: ReadonlyArray<Int16Array<ArrayBuffer>>) {
  const merged = new Int16Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function pcmToWav(pcm: Int16Array<ArrayBuffer>) {
  const header = new DataView(new ArrayBuffer(44));
  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) {
      header.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  writeAscii(0, "RIFF");
  header.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, PCM_SAMPLE_RATE, true);
  header.setUint32(28, PCM_SAMPLE_RATE * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  writeAscii(36, "data");
  header.setUint32(40, pcm.byteLength, true);
  return new Blob([header.buffer, pcm], { type: "audio/wav" });
}

function cacheClip(key: string, url: string) {
  clipUrls.set(key, url);
  if (clipUrls.size <= MAX_CACHED_CLIPS) return;
  const [oldestKey, oldestUrl] = clipUrls.entries().next().value!;
  clipUrls.delete(oldestKey);
  URL.revokeObjectURL(oldestUrl);
}

export function markdownToSpeechText(markdown: string): string {
  return markdown
    .replace(/^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1[^\n]*$/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[ \t]{0,3}(#{1,6}|>)[ \t]?/gm, "")
    .replace(/^[ \t]*([-*+]|\d+[.)])[ \t]+(\[[ xX]\][ \t]+)?/gm, "")
    .replace(/^[ \t]*([-*_])[ \t]*(\1[ \t]*){2,}$\n?/gm, "")
    .replace(/^[ \t]*\|?[ \t:|-]*-{3,}[ \t:|-]*$\n?/gm, "")
    .replace(/^[ \t]*\|[ \t]*(.*?)[ \t]*\|[ \t]*$/gm, "$1")
    .replace(/[ \t]*\|[ \t]*/g, ", ")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
