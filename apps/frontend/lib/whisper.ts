/**
 * Browser-side Whisper transcription via @huggingface/transformers.
 *
 * Truly local: model weights download once from HuggingFace Hub (~75 MB for
 * whisper-tiny.en) and are cached forever in IndexedDB. Audio bytes never
 * leave the browser — there is no API key and no network call after the
 * first model fetch.
 *
 * The pipeline is lazy-loaded on first use so the cost only hits users who
 * actually click the mic button.
 */

import { pipeline, type ProgressCallback } from '@huggingface/transformers';

/** English-only tiny model — ~75 MB, runs comfortably on CPU/WASM. */
const MODEL_ID = 'Xenova/whisper-tiny.en';
/** Whisper expects audio at 16 kHz mono. */
const TARGET_SAMPLE_RATE = 16_000;

export interface ModelProgress {
  /** Filename being downloaded (e.g. "encoder_model.onnx"). */
  file: string;
  /** Bytes loaded so far. */
  loaded: number;
  /** Total expected bytes (may be undefined while headers are still arriving). */
  total: number;
  /** Percentage 0–100 — convenience derived field. */
  pct: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipelinePromise: Promise<any> | null = null;
/** Whether the transcription pipeline is fully ready. */
export function isWhisperReady(): boolean {
  return pipelinePromise !== null;
}

/**
 * Load (or return the cached) Whisper pipeline. Subsequent calls return the
 * same promise so multiple click handlers don't trigger duplicate downloads.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadWhisper(onProgress?: (p: ModelProgress) => void): Promise<any> {
  if (pipelinePromise) return pipelinePromise;

  // ProgressCallback's payload is loosely typed across transformers versions —
  // accept the shape and only forward fields we care about.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const progress_callback: ProgressCallback = (raw: any) => {
    if (raw?.status !== 'progress') return;
    const loaded = Number(raw.loaded ?? 0);
    const total = Number(raw.total ?? 0);
    onProgress?.({
      file: String(raw.file ?? ''),
      loaded,
      total,
      pct: total > 0 ? Math.round((loaded / total) * 100) : 0,
    });
  };

  pipelinePromise = pipeline('automatic-speech-recognition', MODEL_ID, {
    // 'webgpu' if available, falls back to wasm. Empirically wasm is ~2× slower
    // for whisper-tiny but works in every browser; webgpu unlocks Edge/Chrome.
    device: 'webgpu',
    progress_callback,
  }).catch((err: unknown) => {
    // If WebGPU init fails (older browsers), retry with WASM only.
    pipelinePromise = pipeline('automatic-speech-recognition', MODEL_ID, {
      device: 'wasm',
      progress_callback,
    });
    return pipelinePromise;
  });

  return pipelinePromise;
}

/**
 * Decode an arbitrary browser-supported audio Blob into a 16 kHz mono
 * Float32Array — Whisper's expected input shape.
 */
export async function decodeAudioBlob(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  // First decode at the device's native rate (typically 44.1 / 48 kHz).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctor = (window as any).AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctor) throw new Error('AudioContext is not available in this browser');
  const tempCtx = new Ctor();
  let decoded: AudioBuffer;
  try {
    decoded = await tempCtx.decodeAudioData(arrayBuffer);
  } finally {
    void tempCtx.close?.();
  }

  // Resample to 16 kHz mono via OfflineAudioContext. Mixing channels happens
  // automatically when the offline context has 1 output channel.
  const offlineCtx = new OfflineAudioContext({
    numberOfChannels: 1,
    length: Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE)),
    sampleRate: TARGET_SAMPLE_RATE,
  });
  const src = offlineCtx.createBufferSource();
  src.buffer = decoded;
  src.connect(offlineCtx.destination);
  src.start();
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

/** Run transcription on a 16 kHz mono Float32Array. Returns trimmed text. */
export async function transcribe(audio: Float32Array): Promise<string> {
  const pipe = await loadWhisper();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await pipe(audio);
  // Pipeline returns either { text } or [{ text }, …]. Normalise.
  const text = Array.isArray(result)
    ? result.map((r: { text?: string }) => r.text ?? '').join(' ')
    : ((result as { text?: string })?.text ?? '');
  return text.trim();
}

/** Convenience: full pipeline from raw recorded Blob → transcript text. */
export async function transcribeBlob(blob: Blob): Promise<string> {
  const audio = await decodeAudioBlob(blob);
  return transcribe(audio);
}
