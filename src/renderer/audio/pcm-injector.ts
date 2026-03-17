/**
 * pcm-injector.ts — AudioWorklet processor for native audio capture.
 *
 * Receives Float32 PCM frames from the main thread via postMessage
 * and feeds them into the WebRTC audio pipeline.
 *
 * Compiled by tsconfig.renderer.json → dist/renderer/audio/pcm-injector.js
 * Loaded by voice-service via: audioCtx.audioWorklet.addModule('audio/pcm-injector.js')
 */

// AudioWorkletProcessor and registerProcessor are defined in AudioWorkletGlobalScope.
// Declare the minimal interface needed for TypeScript to compile this file.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor
): void;

class PcmInjectorProcessor extends AudioWorkletProcessor {
  private _buf: Float32Array;
  private _pos: number;

  constructor() {
    super();
    this._buf = new Float32Array(0);
    this._pos = 0;
    this.port.onmessage = ({ data }: MessageEvent<{ pcm: Float32Array }>) => {
      // Append incoming PCM to the ring buffer
      const tail = this._buf.subarray(this._pos);
      const next = new Float32Array(tail.length + data.pcm.length);
      next.set(tail);
      next.set(data.pcm, tail.length);
      this._buf = next;
      this._pos = 0;
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out) return true;
    const ch = Math.min(out.length, 2);
    const len = out[0]?.length ?? 128;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < ch; c++) {
        out[c][i] = this._pos < this._buf.length ? this._buf[this._pos++] : 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-injector', PcmInjectorProcessor);
