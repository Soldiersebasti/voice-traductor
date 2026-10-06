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
  /** Emitir la salida en ráfagas de este tamaño (ms de audio), como un modelo que genera por frases. 0 = fragmento a fragmento. */
  burstMs?: number;
  /** Alargar la salida respecto a la entrada (1.2 = la "traducción" dura un 20 % más). Simula un idioma o una voz más lentos. */
  durationFactor?: number;
}

export class MockEngine extends BaseEngine {
  readonly name = 'mock';
  readonly inputSampleRate: number;
  readonly outputSampleRate: number;
  private readonly delayMs: number;
  private readonly transcriptEveryMs: number;
  private readonly burstMs: number;
  private readonly durationFactor: number;
  private burst: Int16Array[] = [];
  private burstAccMs = 0;
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
    this.burstMs = opts.burstMs ?? 0;
    this.durationFactor = opts.durationFactor ?? 1;
    this.nextTranscriptAt = this.transcriptEveryMs;
  }

  async start(): Promise<void> {
    this.emit({ type: 'ready', sessionId: 'mock' });
  }

  sendAudio(pcm: Int16Array): void {
    // Alargar o acortar la "traducción": se remuestrea a otra tasa y se etiqueta con la de salida.
    const out = resampleLinear(pcm, this.inputSampleRate, Math.round(this.outputSampleRate * this.durationFactor));
    this.sentMs += samplesToMs(pcm.length, this.inputSampleRate);
    if (this.burstMs > 0) {
      this.burst.push(out);
      this.burstAccMs += samplesToMs(pcm.length, this.inputSampleRate);
      if (this.burstAccMs >= this.burstMs) this.flushBurst();
    } else this.later(() => this.emit({ type: 'audio', pcm: out, sampleRate: this.outputSampleRate }));
    if (this.sentMs >= this.nextTranscriptAt) {
      this.nextTranscriptAt += this.transcriptEveryMs;
      const n = ++this.segment;
      this.later(() => this.emit({ type: 'transcript', channel: 'target', text: `Mock segment ${n}. `, final: false }));
    }
  }

  async finish(): Promise<void> {
    this.flushBurst();
    await sleep(this.delayMs + 200);
  }

  private flushBurst(): void {
    if (!this.burst.length) return;
    const parts = this.burst;
    this.burst = [];
    this.burstAccMs = 0;
    let total = 0;
    for (const p of parts) total += p.length;
    const joined = new Int16Array(total);
    let off = 0;
    for (const p of parts) {
      joined.set(p, off);
      off += p.length;
    }
    this.later(() => this.emit({ type: 'audio', pcm: joined, sampleRate: this.outputSampleRate }));
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
