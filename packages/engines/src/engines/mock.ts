import { BaseEngine } from '../base.js';
import { resampleLinear } from '../audio/resample.js';
import { samplesToMs, sleep } from '../audio/pcm.js';
import type { EngineOptions } from '../types.js';

/**
 * Motor simulado: devuelve el mismo audio con un retraso fijo y emite un
 * "subtítulo" cada cierto tiempo. Sirve para probar el banco de punta a punta
 * sin claves ni red, y para verificar que las métricas miden lo que dicen medir
 * (retraso conocido → retraso medido).
 */
export interface MockEngineOptions extends Partial<EngineOptions> {
  delayMs?: number;
  inputSampleRate?: number;
  outputSampleRate?: number;
  transcriptEveryMs?: number;
}

export class MockEngine extends BaseEngine {
  readonly name = 'mock';
  readonly inputSampleRate: number;
  readonly outputSampleRate: number;
  private readonly delayMs: number;
  private readonly transcriptEveryMs: number;
  private timers = new Set<NodeJS.Timeout>();
  private sentMs = 0;
  private nextTranscriptAt: number;
  private segment = 0;

  constructor(opts: MockEngineOptions = {}) {
    super();
    this.inputSampleRate = opts.inputSampleRate ?? 16000;
    this.outputSampleRate = opts.outputSampleRate ?? 24000;
    this.delayMs = opts.delayMs ?? 1500;
    this.transcriptEveryMs = opts.transcriptEveryMs ?? 2000;
    this.nextTranscriptAt = this.transcriptEveryMs;
  }

  async start(): Promise<void> {
    this.emit({ type: 'ready', sessionId: 'mock' });
  }

  sendAudio(pcm: Int16Array): void {
    const out = resampleLinear(pcm, this.inputSampleRate, this.outputSampleRate);
    this.sentMs += samplesToMs(pcm.length, this.inputSampleRate);
    this.later(() => this.emit({ type: 'audio', pcm: out, sampleRate: this.outputSampleRate }));
    if (this.sentMs >= this.nextTranscriptAt) {
      this.nextTranscriptAt += this.transcriptEveryMs;
      const n = ++this.segment;
      this.later(() => this.emit({ type: 'transcript', channel: 'target', text: `Mock segment ${n}. `, final: false }));
    }
  }

  async finish(): Promise<void> {
    await sleep(this.delayMs + 200);
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private later(fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, this.delayMs);
    this.timers.add(t);
  }
}
