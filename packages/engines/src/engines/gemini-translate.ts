import WebSocket from 'ws';
import type { IncomingMessage } from 'node:http';
import { BaseEngine } from '../base.js';
import type { EngineOptions } from '../types.js';
import { base64FromInt16, deepMerge, int16FromBase64, msToSamples, parseDurationMs, samplesToMs, silence, sleep } from '../audio/pcm.js';

/**
 * Adaptador para `gemini-3.5-live-translate-preview` (Gemini Live API).
 *
 * Referencia: guía oficial de Live Translate y tipos del SDK @google/genai.
 *  - WebSocket BidiGenerateContent; primer mensaje `setup` con
 *    generationConfig.translationConfig.targetLanguageCode.
 *  - Entrada: `realtimeInput.audio` PCM16 16 kHz (base64, mimeType audio/pcm;rate=16000).
 *  - Salida: serverContent.modelTurn.parts[].inlineData (PCM16 24 kHz),
 *    serverContent.outputTranscription / inputTranscription.
 *  - La conexión dura ~10 min: el servidor avisa con `goAway` y da un handle
 *    de reanudación (`sessionResumptionUpdate`). Este adaptador reconecta con
 *    ese handle y guarda el audio del intervalo.
 *  - `contextWindowCompression` permite sesiones de más de 15 minutos.
 */
export interface GeminiEngineOptions extends EngineOptions {
  apiKey: string;
  /** Por defecto `gemini-3.5-live-translate-preview`. */
  model?: string;
  /** Por defecto `v1beta`. */
  apiVersion?: string;
  /** Por defecto `generativelanguage.googleapis.com`. */
  host?: string;
  /** Si el hablante dice algo ya en el idioma destino, repetirlo en vez de callar. Por defecto sí. */
  echoTargetLanguage?: boolean;
  /** Pedir transcripciones de entrada y salida. Por defecto sí. */
  transcripts?: boolean;
  /** Compresión de contexto para sesiones largas. Por defecto sí. */
  contextCompression?: boolean;
  /** Reanudación de sesión entre conexiones. Por defecto sí. */
  resumption?: boolean;
  /** Reconectar con esta antelación respecto al tiempo que anuncia goAway (ms). Por defecto 2.5 s. */
  goAwayLeadMs?: number;
  /** Audio que se guarda mientras se reconecta (ms). Por defecto 10 s. */
  reconnectBufferMs?: number;
}

const DEFAULT_MODEL = 'gemini-3.5-live-translate-preview';

interface Conn {
  id: number;
  ws: WebSocket;
  openedAt: number;
  ready: boolean;
  closedByUs: boolean;
  reason: string;
}

export class GeminiTranslateEngine extends BaseEngine {
  readonly name = 'gemini';
  readonly inputSampleRate = 16000;
  readonly outputSampleRate = 24000;

  private conn: Conn | null = null;
  private handle: string | null = null;
  private stopping = false;
  private reconnecting = false;
  private readyEmitted = false;
  private nextId = 1;
  private pending: Int16Array[] = [];
  private pendingMs = 0;
  private droppedMs = 0;
  private goAwayTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: GeminiEngineOptions) {
    super();
    if (!opts.apiKey) throw new Error('Falta GEMINI_API_KEY');
  }

  async start(): Promise<void> {
    this.conn = await this.open('inicial');
    this.readyEmitted = true;
    this.emit({ type: 'ready' });
  }

  sendAudio(pcm: Int16Array): void {
    if (this.stopping) return;
    const c = this.conn;
    if (!c || !c.ready || c.ws.readyState !== WebSocket.OPEN) {
      this.enqueue(pcm);
      return;
    }
    this.flushPending(c);
    this.sendChunk(c, pcm);
  }

  async finish(o: { timeoutMs?: number } = {}): Promise<void> {
    const c = this.conn;
    if (c && c.ready && c.ws.readyState === WebSocket.OPEN) {
      const chunk = silence(msToSamples(100, this.inputSampleRate));
      for (let i = 0; i < 15; i++) this.sendChunk(c, chunk);
      this.send(c, { realtimeInput: { audioStreamEnd: true } });
    }
    await this.waitForQuiet({ quietMs: 2500, minWaitMs: 2000, timeoutMs: o.timeoutMs ?? 20000 });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.goAwayTimer) clearTimeout(this.goAwayTimer);
    if (this.conn) this.close(this.conn);
    this.conn = null;
  }

  // ---------------------------------------------------------------- sesión

  private url(): string {
    const host = this.opts.host ?? 'generativelanguage.googleapis.com';
    const v = this.opts.apiVersion ?? 'v1beta';
    return `wss://${host}/ws/google.ai.generativelanguage.${v}.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(this.opts.apiKey)}`;
  }

  private setupMessage(): Record<string, unknown> {
    const setup: Record<string, unknown> = {
      model: `models/${this.opts.model ?? DEFAULT_MODEL}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        translationConfig: {
          targetLanguageCode: this.opts.targetLanguage,
          echoTargetLanguage: this.opts.echoTargetLanguage ?? true,
        },
      },
    };
    if (this.opts.transcripts !== false) {
      setup.outputAudioTranscription = {};
      setup.inputAudioTranscription = this.opts.sourceLanguageHint ? { languageCodes: [this.opts.sourceLanguageHint] } : {};
    }
    if (this.opts.contextCompression !== false) setup.contextWindowCompression = { slidingWindow: {} };
    if (this.opts.resumption !== false) setup.sessionResumption = this.handle ? { handle: this.handle } : {};
    deepMerge(setup, this.opts.extra);
    return { setup };
  }

  private open(reason: string): Promise<Conn> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url());
      const c: Conn = { id: this.nextId++, ws, openedAt: 0, ready: false, closedByUs: false, reason };
      let settled = false;
      const fail = (err: Error) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };
      const resumed = Boolean(this.handle);

      ws.on('open', () => {
        c.openedAt = Date.now();
        const setup = this.setupMessage();
        ws.send(JSON.stringify(setup));
        this.emit({ type: 'raw', direction: 'out', payload: setup });
        this.emit({ type: 'status', code: 'session.opened', message: `Conexión Gemini #${c.id} abierta (${reason}${resumed ? ', con handle de reanudación' : ''})`, data: { id: c.id, reason, resumed } });
      });
      ws.on('unexpected-response', (_req, res: IncomingMessage) => {
        let body = '';
        res.on('data', (d) => (body += d.toString()));
        res.on('end', () => {
          const msg = `Gemini respondió HTTP ${res.statusCode} al abrir la conexión: ${body.slice(0, 500)}`;
          this.emit({ type: 'error', message: msg, fatal: true, data: { status: res.statusCode, body } });
          fail(new Error(msg));
        });
      });
      ws.on('message', (data) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(data.toString()) as Record<string, unknown>;
        } catch {
          this.emit({ type: 'error', message: `Mensaje no JSON de Gemini (conexión #${c.id})`, fatal: false });
          return;
        }
        if (msg.setupComplete !== undefined) {
          c.ready = true;
          const sc = msg.setupComplete as { sessionId?: string } | null;
          this.emit({ type: 'status', code: 'session.ready', message: `Gemini #${c.id} lista (setupComplete${sc?.sessionId ? ', sesión ' + sc.sessionId : ''})`, data: msg.setupComplete });
          if (!settled) {
            settled = true;
            resolve(c);
          }
          return;
        }
        this.onMessage(c, msg);
      });
      ws.on('error', (err) => {
        this.emit({ type: 'error', message: `WebSocket Gemini #${c.id}: ${err.message}`, fatal: false });
        fail(err);
      });
      ws.on('close', (code, reasonBuf) => {
        fail(new Error(`Conexión Gemini #${c.id} cerrada antes de estar lista (código ${code}${reasonBuf.length ? ': ' + reasonBuf.toString() : ''})`));
        this.onClose(c, code, reasonBuf.toString());
      });
    });
  }

  private onMessage(c: Conn, msg: Record<string, unknown>): void {
    const sc = msg.serverContent as Record<string, unknown> | undefined;
    if (sc) {
      const turn = sc.modelTurn as { parts?: Array<Record<string, unknown>> } | undefined;
      for (const part of turn?.parts ?? []) {
        const inline = part.inlineData as { data?: string; mimeType?: string } | undefined;
        if (inline?.data) {
          const rate = parseRate(inline.mimeType) ?? this.outputSampleRate;
          this.emit({ type: 'audio', pcm: int16FromBase64(inline.data), sampleRate: rate });
        } else if (typeof part.text === 'string') {
          this.emit({ type: 'status', code: 'model.text', message: `Texto inesperado del modelo: ${part.text.slice(0, 200)}` });
        }
      }
      const out = sc.outputTranscription as { text?: string } | undefined;
      if (out?.text) this.emit({ type: 'transcript', channel: 'target', text: out.text, final: false });
      const inp = sc.inputTranscription as { text?: string } | undefined;
      if (inp?.text) this.emit({ type: 'transcript', channel: 'source', text: inp.text, final: false });
      if (sc.interrupted) this.emit({ type: 'status', code: 'turn.interrupted', message: 'El modelo marcó la salida como interrumpida' });
      if (sc.turnComplete || sc.generationComplete) this.emit({ type: 'raw', direction: 'in', payload: { serverContent: { turnComplete: sc.turnComplete, generationComplete: sc.generationComplete, turnCompleteReason: sc.turnCompleteReason } } });
      return;
    }
    if (msg.goAway !== undefined) {
      const ga = msg.goAway as { timeLeft?: unknown } | null;
      const leftMs = parseDurationMs(ga?.timeLeft);
      this.emit({ type: 'status', code: 'session.goaway', message: `Gemini avisa que cerrará la conexión #${c.id} en ${leftMs === null ? '?' : Math.round(leftMs / 1000) + ' s'}`, data: msg.goAway });
      this.scheduleResume(c, leftMs);
      return;
    }
    if (msg.sessionResumptionUpdate !== undefined) {
      const u = msg.sessionResumptionUpdate as { newHandle?: string; resumable?: boolean } | null;
      if (u?.resumable && u.newHandle) this.handle = u.newHandle;
      this.emit({ type: 'raw', direction: 'in', payload: { sessionResumptionUpdate: { resumable: u?.resumable, hasHandle: Boolean(u?.newHandle) } } });
      return;
    }
    this.emit({ type: 'raw', direction: 'in', payload: msg });
  }

  private onClose(c: Conn, code: number, reason: string): void {
    c.ready = false;
    const unexpected = !c.closedByUs && !this.stopping;
    this.emit({
      type: 'status',
      code: unexpected ? 'session.closed_unexpectedly' : 'session.closed',
      message: `Conexión Gemini #${c.id} cerrada (código ${code}${reason ? ', ' + reason : ''}${c.closedByUs ? ', por nosotros' : ''})`,
      data: { id: c.id, code, reason, byUs: c.closedByUs },
    });
    if (this.conn === c) {
      this.conn = null;
      if (unexpected) void this.resume('reconexión');
    }
  }

  private close(c: Conn): void {
    c.closedByUs = true;
    try {
      if (c.ws.readyState === WebSocket.CONNECTING) c.ws.terminate();
      else if (c.ws.readyState === WebSocket.OPEN) c.ws.close(1000, 'bye');
    } catch {
      /* ya cerrada */
    }
  }

  private send(c: Conn, msg: unknown): void {
    c.ws.send(JSON.stringify(msg));
  }

  private sendChunk(c: Conn, pcm: Int16Array): void {
    this.send(c, { realtimeInput: { audio: { data: base64FromInt16(pcm), mimeType: `audio/pcm;rate=${this.inputSampleRate}` } } });
  }

  // ------------------------------------------------------- reanudación

  private scheduleResume(c: Conn, timeLeftMs: number | null): void {
    if (this.goAwayTimer || this.stopping) return;
    const lead = this.opts.goAwayLeadMs ?? 2500;
    const delay = Math.max(0, (timeLeftMs ?? 0) - lead);
    this.goAwayTimer = setTimeout(() => {
      this.goAwayTimer = null;
      if (this.conn === c) void this.resume('goAway');
    }, delay);
  }

  private async resume(reason: string): Promise<void> {
    if (this.reconnecting || this.stopping) return;
    this.reconnecting = true;
    if (this.goAwayTimer) {
      clearTimeout(this.goAwayTimer);
      this.goAwayTimer = null;
    }
    const old = this.conn;
    this.conn = null; // el audio se guarda en `pending` mientras tanto
    this.emit({ type: 'status', code: 'session.resuming', message: `Reconectando con Gemini (${reason}${this.handle ? ', con handle' : ', sin handle: sesión nueva'})`, data: { reason, hasHandle: Boolean(this.handle) } });
    if (old) this.close(old);
    let attempt = 0;
    while (!this.stopping) {
      try {
        const c = await this.open(reason);
        this.conn = c;
        this.emit({ type: 'status', code: 'session.resumed', message: `Gemini reanudada en conexión #${c.id} tras ${attempt + 1} intento(s)`, data: { id: c.id, attempts: attempt + 1 } });
        this.flushPending(c);
        break;
      } catch (err) {
        attempt++;
        if (attempt === 2 && this.handle) {
          this.emit({ type: 'status', code: 'session.handle_dropped', message: 'El handle de reanudación no funcionó dos veces; se abre una sesión nueva sin contexto' });
          this.handle = null;
        }
        if (attempt > 5) {
          this.emit({ type: 'error', message: `Reconexión con Gemini fallida tras ${attempt} intentos: ${(err as Error).message}`, fatal: true });
          break;
        }
        await sleep(Math.min(8000, 500 * 2 ** attempt));
      }
    }
    this.reconnecting = false;
  }

  private enqueue(pcm: Int16Array): void {
    this.pending.push(pcm);
    this.pendingMs += samplesToMs(pcm.length, this.inputSampleRate);
    const cap = this.opts.reconnectBufferMs ?? 10_000;
    while (this.pendingMs > cap && this.pending.length) {
      const d = this.pending.shift()!;
      const ms = samplesToMs(d.length, this.inputSampleRate);
      this.pendingMs -= ms;
      this.droppedMs += ms;
    }
  }

  private flushPending(c: Conn): void {
    if (this.pending.length === 0 && this.droppedMs === 0) return;
    const sent = this.pendingMs;
    for (const p of this.pending) this.sendChunk(c, p);
    this.pending = [];
    this.pendingMs = 0;
    this.emit({
      type: 'status',
      code: 'audio.buffered_flush',
      message: `Se enviaron ${Math.round(sent)} ms de audio guardados durante la reconexión; ${Math.round(this.droppedMs)} ms descartados`,
      data: { sentMs: sent, droppedMs: this.droppedMs },
    });
    this.droppedMs = 0;
  }
}

function parseRate(mime?: string): number | null {
  if (!mime) return null;
  const m = /rate=(\d+)/.exec(mime);
  return m ? parseInt(m[1], 10) : null;
}
