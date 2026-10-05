import { sleep } from './audio/pcm.js';
import type { EngineEvent, EngineListener, TranslationEngine } from './types.js';

/** Base con el manejo de oyentes y la espera de "ya no sale más audio". */
export abstract class BaseEngine implements TranslationEngine {
  abstract readonly name: string;
  abstract readonly inputSampleRate: number;
  abstract readonly outputSampleRate: number;

  private listeners = new Set<EngineListener>();
  protected lastOutputAt = 0;
  protected outputSamples = 0;

  on(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  protected emit(event: EngineEvent): void {
    if (event.type === 'audio') {
      this.lastOutputAt = Date.now();
      this.outputSamples += event.pcm.length;
    }
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        // Un oyente con errores no debe tumbar al motor.
        console.error(`[${this.name}] error en oyente:`, err);
      }
    }
  }

  /**
   * Espera a que pase `quietMs` sin audio de salida, con una espera mínima
   * (`minWaitMs`) para dar tiempo a que llegue la última frase, y un tope.
   */
  protected async waitForQuiet(o: { quietMs: number; minWaitMs: number; timeoutMs: number }): Promise<void> {
    const start = Date.now();
    for (;;) {
      const now = Date.now();
      const sinceOutput = now - Math.max(this.lastOutputAt, start);
      if (now - start >= o.minWaitMs && sinceOutput >= o.quietMs) return;
      if (now - start >= o.timeoutMs) {
        this.emit({ type: 'status', code: 'finish.timeout', message: `Se agotó el tiempo de espera (${o.timeoutMs} ms) esperando el final de la salida` });
        return;
      }
      await sleep(100);
    }
  }

  abstract start(): Promise<void>;
  abstract sendAudio(pcm: Int16Array): void;
  abstract finish(opts?: { timeoutMs?: number }): Promise<void>;
  abstract stop(): Promise<void>;
}
