import WebSocket from 'ws';
import type { IncomingMessage } from 'node:http';
import { BaseEngine } from '../base.js';
import type { EngineOptions } from '../types.js';
import { base64FromInt16, dbfs, deepMerge, int16FromBase64, msToSamples, samplesToMs, silence, sleep } from '../audio/pcm.js';

/**
 * Adaptador para `gpt-realtime-translate` (OpenAI Realtime Translation API).
 *
 * Referencia: cookbook oficial "Build Live Translation Apps with gpt-realtime-translate".
 *  - Endpoint dedicado: wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate
 *  - Entrada continua PCM16 24 kHz con `session.input_audio_buffer.append` (incluido el silencio).
 *  - Salida: `session.output_audio.delta` (PCM16 24 kHz, ~200 ms), `session.output_transcript.delta`,
 *    `session.input_transcript.delta` (si se activa transcripción con gpt-realtime-whisper).
 *  - Sin turnos, sin response.create, sin prompt ni selección de voz.
 *
 * Las sesiones Realtime tienen un máximo de 60 minutos, así que este adaptador
 * rota a una sesión nueva antes del límite, buscando un momento de silencio
 * para que el cambio no corte una frase.
 */
export interface OpenAIEngineOptions extends EngineOptions {
  apiKey: string;
  /** Por defecto `gpt-realtime-translate`. */
  model?: string;
  /** Por defecto `wss://api.openai.com/v1/realtime/translations`. */
  url?: string;
  /** `near_field` para micrófono cercano (consola, solapa), `far_field` para ambiente. */
  noiseReduction?: 'near_field' | 'far_field' | 'none';
  /** Transcripción del idioma original con gpt-realtime-whisper. Por defecto sí. */
  inputTranscription?: boolean;
  /** Rotar a una sesión nueva pasado este tiempo (ms). 0 desactiva. Por defecto 50 min. */
  rotateAfterMs?: number;
  /** Abrir la sesión de reemplazo con esta antelación (ms). Por defecto 90 s. */
  rotatePrepareMs?: number;
  /** Si no hay silencio, forzar la rotación pasado este margen extra (ms). Por defecto 5 min. */
  rotateForceMs?: number;
  /** Tiempo que se mantiene abierta la sesión vieja para que termine de hablar (ms). Por defecto 8 s. */
  drainMs?: number;
  /** Audio que se guarda mientras se reconecta (ms). Lo que exceda se descarta. Por defecto 10 s. */
  reconnectBufferMs?: number;
  /** Umbral de silencio en dBFS para elegir el momento de rotación. Por defecto -50. */
  silenceDb?: number;
}

const DEFAULT_URL = 'wss://api.openai.com/v1/realtime/translations';
const DEFAULT_MODEL = 'gpt-realtime-translate';

interface Session {
  id: number;
  ws: WebSocket;
  openedAt: number;
  ready: boolean;
  closedByUs: boolean;
  reason: string;
}

export class OpenAITranslateEngine extends BaseEngine {
  readonly name = 'openai';
  readonly inputSampleRate = 24000;
  readonly outputSampleRate = 24000;

  private active: Session | null = null;
  private standby: Session | null = null;
  private standbyOpening = false;
  private reconnecting = false;
  private stopping = false;
  private nextId = 1;
  private quietMs = 0;
  private pending: Int16Array[] = [];
  private pendingMs = 0;
  private droppedMs = 0;
  private timers = new Set<NodeJS.Timeout>();
  private rttTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: OpenAIEngineOptions) {
    super();
    if (!opts.apiKey) throw new Error('Falta OPENAI_API_KEY');
  }

  async start(): Promise<void> {
    this.active = await this.open('inicial');
    this.emit({ type: 'ready' });
    // Ida y vuelta de red medida con ping/pong del WebSocket, cada 15 s.
    this.rttTimer = setInterval(() => {
      const s = this.active;
      if (!s || s.ws.readyState !== WebSocket.OPEN) return;
      const sent = Date.now();
      try {
        s.ws.ping();
        s.ws.once('pong', () => this.emit({ type: 'status', code: 'net.rtt', message: `Ida y vuelta de red: ${Date.now() - sent} ms`, data: { rttMs: Date.now() - sent } }));
      } catch {
        /* conexión cerrándose */
      }
    }, 15_000);
  }

  sendAudio(pcm: Int16Array): void {
    if (this.stopping) return;
    this.trackQuiet(pcm);
    this.maybeRotate();
    const s = this.active;
    if (!s || !s.ready || s.ws.readyState !== WebSocket.OPEN) {
      this.enqueue(pcm);
      return;
    }
    this.flushPending(s);
    this.append(s, pcm);
  }

  async finish(o: { timeoutMs?: number } = {}): Promise<void> {
    const s = this.active;
    if (s && s.ready && s.ws.readyState === WebSocket.OPEN) {
      // Dos segundos de silencio para que el modelo cierre la última frase.
      const chunk = silence(msToSamples(100, this.inputSampleRate));
      for (let i = 0; i < 20; i++) this.append(s, chunk);
    }
    await this.waitForQuiet({ quietMs: 2500, minWaitMs: 2000, timeoutMs: o.timeoutMs ?? 20000 });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.rttTimer) clearInterval(this.rttTimer);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const s of [this.active, this.standby]) if (s) this.close(s);
    this.active = null;
    this.standby = null;
  }

  // ---------------------------------------------------------------- sesión

  private sessionUpdate(): Record<string, unknown> {
    const input: Record<string, unknown> = {};
    if (this.opts.inputTranscription !== false) {
      input.transcription = {
        model: 'gpt-realtime-whisper',
        ...(this.opts.sourceLanguageHint ? { language: this.opts.sourceLanguageHint } : {}),
      };
    }
    const nr = this.opts.noiseReduction ?? 'near_field';
    if (nr !== 'none') input.noise_reduction = { type: nr };
    const session: Record<string, unknown> = {
      audio: { input, output: { language: this.opts.targetLanguage } },
    };
    deepMerge(session, this.opts.extra);
    return { type: 'session.update', session };
  }

  private open(reason: string): Promise<Session> {
    return new Promise((resolve, reject) => {
      const model = this.opts.model ?? DEFAULT_MODEL;
      const url = `${this.opts.url ?? DEFAULT_URL}?model=${encodeURIComponent(model)}`;
      const connectStart = Date.now();
      const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${this.opts.apiKey}` } });
      const s: Session = { id: this.nextId++, ws, openedAt: 0, ready: false, closedByUs: false, reason };
      let settled = false;
      const fail = (err: Error) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      ws.on('open', () => {
        s.openedAt = Date.now();
        const update = this.sessionUpdate();
        ws.send(JSON.stringify(update));
        this.emit({ type: 'raw', direction: 'out', payload: update });
        s.ready = true;
        const connectMs = Date.now() - connectStart;
        this.emit({ type: 'status', code: 'session.opened', message: `Sesión OpenAI #${s.id} abierta (${reason}, modelo ${model}, conexión ${connectMs} ms)`, data: { id: s.id, reason, model, connectMs } });
        settled = true;
        resolve(s);
      });
      ws.on('unexpected-response', (_req, res: IncomingMessage) => {
        let body = '';
        res.on('data', (d) => (body += d.toString()));
        res.on('end', () => {
          const msg = `OpenAI respondió HTTP ${res.statusCode} al abrir la sesión: ${body.slice(0, 500)}`;
          this.emit({ type: 'error', message: msg, fatal: true, data: { status: res.statusCode, body } });
          fail(new Error(msg));
        });
      });
      ws.on('message', (data) => this.onMessage(s, data));
      ws.on('error', (err) => {
        this.emit({ type: 'error', message: `WebSocket OpenAI #${s.id}: ${err.message}`, fatal: false });
        fail(err);
      });
      ws.on('close', (code, reasonBuf) => {
        fail(new Error(`Sesión OpenAI #${s.id} cerrada antes de abrir (código ${code})`));
        this.onClose(s, code, reasonBuf.toString());
      });
    });
  }

  private onMessage(s: Session, data: WebSocket.RawData): void {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(data.toString()) as Record<string, unknown>;
    } catch {
      this.emit({ type: 'error', message: `Mensaje no JSON de OpenAI (sesión #${s.id})`, fatal: false });
      return;
    }
    const type = typeof ev.type === 'string' ? ev.type : '';
    switch (type) {
      case 'session.output_audio.delta':
        if (typeof ev.delta === 'string') this.emit({ type: 'audio', pcm: int16FromBase64(ev.delta), sampleRate: this.outputSampleRate });
        return;
      case 'session.output_transcript.delta':
        this.emit({ type: 'transcript', channel: 'target', text: String(ev.delta ?? ''), final: false });
        return;
      case 'session.input_transcript.delta':
        this.emit({ type: 'transcript', channel: 'source', text: String(ev.delta ?? ''), final: false });
        return;
      case 'error': {
        const e = ev.error as { message?: string } | undefined;
        this.emit({ type: 'error', message: `OpenAI (sesión #${s.id}): ${e?.message ?? JSON.stringify(ev)}`, fatal: false, data: ev });
        return;
      }
    }
    if (type.endsWith('transcript.done') || type.endsWith('transcript.completed')) {
      const channel = type.includes('input') ? 'source' : 'target';
      this.emit({ type: 'transcript', channel, text: String(ev.transcript ?? ev.text ?? ''), final: true });
      return;
    }
    this.emit({ type: 'raw', direction: 'in', payload: ev });
  }

  private onClose(s: Session, code: number, reason: string): void {
    s.ready = false;
    const unexpected = !s.closedByUs && !this.stopping;
    this.emit({
      type: 'status',
      code: unexpected ? 'session.closed_unexpectedly' : 'session.closed',
      message: `Sesión OpenAI #${s.id} cerrada (código ${code}${reason ? ', ' + reason : ''}${s.closedByUs ? ', por nosotros' : ''})`,
      data: { id: s.id, code, reason, byUs: s.closedByUs },
    });
    if (this.standby === s) this.standby = null;
    if (this.active === s) {
      this.active = null;
      if (unexpected) void this.reconnect();
    }
  }

  private close(s: Session): void {
    s.closedByUs = true;
    try {
      if (s.ws.readyState === WebSocket.CONNECTING) s.ws.terminate();
      else if (s.ws.readyState === WebSocket.OPEN) s.ws.close(1000, 'bye');
    } catch {
      /* ya cerrada */
    }
  }

  private append(s: Session, pcm: Int16Array): void {
    s.ws.send(JSON.stringify({ type: 'session.input_audio_buffer.append', audio: base64FromInt16(pcm) }));
  }

  // ------------------------------------------------------------- rotación

  private trackQuiet(pcm: Int16Array): void {
    const ms = samplesToMs(pcm.length, this.inputSampleRate);
    this.quietMs = dbfs(pcm) < (this.opts.silenceDb ?? -50) ? this.quietMs + ms : 0;
  }

  private maybeRotate(): void {
    const rotateAfter = this.opts.rotateAfterMs ?? 50 * 60_000;
    const s = this.active;
    if (!rotateAfter || !s || this.reconnecting) return;
    const age = Date.now() - s.openedAt;
    const prepareAt = rotateAfter - (this.opts.rotatePrepareMs ?? 90_000);
    if (age >= prepareAt && !this.standby && !this.standbyOpening) {
      this.standbyOpening = true;
      this.open('rotación')
        .then((next) => {
          if (this.stopping) this.close(next);
          else this.standby = next;
        })
        .catch((err: Error) => this.emit({ type: 'error', message: `No se pudo abrir la sesión de reemplazo: ${err.message}`, fatal: false }))
        .finally(() => (this.standbyOpening = false));
    }
    const next = this.standby;
    if (!next || !next.ready) return;
    const forced = age >= rotateAfter + (this.opts.rotateForceMs ?? 5 * 60_000);
    if (age >= rotateAfter - 60_000 && (this.quietMs >= 400 || forced)) this.switchTo(next, forced ? 'forzada sin silencio' : 'en silencio');
  }

  private switchTo(next: Session, reason: string): void {
    const old = this.active;
    this.active = next;
    this.standby = null;
    this.emit({
      type: 'status',
      code: 'session.rotated',
      message: `Rotación de sesión #${old?.id ?? '-'} → #${next.id} (${reason}, silencio previo ${Math.round(this.quietMs)} ms)`,
      data: { from: old?.id, to: next.id, reason, quietMs: this.quietMs },
    });
    if (!old) return;
    if (old.ws.readyState === WebSocket.OPEN) {
      const chunk = silence(msToSamples(100, this.inputSampleRate));
      for (let i = 0; i < 15; i++) this.append(old, chunk);
    }
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.close(old);
    }, this.opts.drainMs ?? 8000);
    this.timers.add(t);
  }

  // ----------------------------------------------------------- reconexión

  private async reconnect(): Promise<void> {
    if (this.reconnecting || this.stopping) return;
    this.reconnecting = true;
    this.emit({ type: 'status', code: 'session.reconnecting', message: 'Reconectando con OpenAI' });
    let attempt = 0;
    while (!this.stopping) {
      try {
        const s = await this.open('reconexión');
        this.active = s;
        this.emit({ type: 'status', code: 'session.reconnected', message: `Reconectado: sesión #${s.id} tras ${attempt + 1} intento(s)`, data: { id: s.id, attempts: attempt + 1 } });
        this.flushPending(s);
        break;
      } catch (err) {
        attempt++;
        if (attempt > 5) {
          this.emit({ type: 'error', message: `Reconexión con OpenAI fallida tras ${attempt} intentos: ${(err as Error).message}`, fatal: true });
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

  private flushPending(s: Session): void {
    if (this.pending.length === 0 && this.droppedMs === 0) return;
    const sent = this.pendingMs;
    for (const p of this.pending) this.append(s, p);
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
