/**
 * Contrato común de un motor de traducción de voz en tiempo real.
 *
 * El banco de pruebas y, más adelante, el trabajador en vivo hablan con los
 * motores únicamente a través de esta interfaz. Cambiar de proveedor no debe
 * tocar nada fuera de `engines/`.
 */

export type LanguageCode = string; // ISO-639-1 / BCP-47: 'es', 'en', 'pt-BR'...

export interface EngineOptions {
  /** Idioma de salida (lo que escucha el oyente). */
  targetLanguage: LanguageCode;
  /** Pista opcional del idioma de entrada. Los dos motores detectan el idioma solos. */
  sourceLanguageHint?: LanguageCode;
  /**
   * Sobrescrituras libres que se fusionan en el payload de configuración del
   * proveedor (session.update en OpenAI, setup en Gemini). Sirve para probar
   * parámetros sin tocar código.
   */
  extra?: Record<string, unknown>;
}

export type EngineEvent =
  /** El motor está listo para recibir audio. */
  | { type: 'ready'; sessionId?: string }
  /** Audio traducido, PCM16 mono a `sampleRate`. */
  | { type: 'audio'; pcm: Int16Array; sampleRate: number }
  /** Texto: `target` es la traducción, `source` la transcripción del original. */
  | { type: 'transcript'; channel: 'source' | 'target'; text: string; final: boolean }
  /** Eventos de ciclo de vida: apertura, rotación, reconexión, goAway... */
  | { type: 'status'; code: string; message: string; data?: unknown }
  /** Cualquier mensaje del protocolo que no sea audio, para depuración. */
  | { type: 'raw'; direction: 'in' | 'out'; payload: unknown }
  | { type: 'error'; message: string; fatal: boolean; data?: unknown }
  | { type: 'closed'; code?: number; reason?: string };

export type EngineListener = (event: EngineEvent) => void;

export interface TranslationEngine {
  readonly name: string;
  /** Tasa de muestreo que el motor espera recibir (PCM16 mono). */
  readonly inputSampleRate: number;
  /** Tasa de muestreo del audio que emite (PCM16 mono). */
  readonly outputSampleRate: number;
  /** Abre la sesión. Resuelve cuando el motor puede recibir audio. */
  start(): Promise<void>;
  /** Envía un fragmento de audio PCM16 mono a `inputSampleRate`. Debe llamarse de forma continua, incluido el silencio. */
  sendAudio(pcm: Int16Array): void;
  /** Avisa que no habrá más audio y espera a que el motor termine de emitir (o venza el tiempo límite). */
  finish(opts?: { timeoutMs?: number }): Promise<void>;
  /** Cierra todo. */
  stop(): Promise<void>;
  /** Suscribe un oyente. Devuelve la función para desuscribirse. */
  on(listener: EngineListener): () => void;
}
