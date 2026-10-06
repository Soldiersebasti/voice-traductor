import WebSocket from 'ws';
import type { IncomingMessage } from 'node:http';
import { BaseEngine } from '../base.js';
import type { EngineOptions } from '../types.js';
import { base64FromInt16, dbfs, deepMerge, int16FromBase64, samplesToMs, sleep } from '../audio/pcm.js';

/**
 * Adaptador para `qwen3.8-livetranslate-flash-realtime` (Alibaba Cloud Model Studio,
 * API Realtime por WebSocket, región Singapur / edición internacional).
 *
 * Protocolo (documentación de Model Studio, SDK oficial de Python
 * `dashscope.audio.qwen_omni` y demos públicos del modelo):
 *  - Endpoint: wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime?model=<modelo>
 *    con cabecera `Authorization: Bearer <DASHSCOPE_API_KEY>`.
 *  - El servidor manda `session.created`; el cliente configura con `session.update`
 *    (`translation.language` = idioma destino, `input_audio_transcription` para el
 *    texto original, formatos `pcm`) y recibe `session.updated`.
 *  - Entrada continua PCM16 mono 16 kHz con `input_audio_buffer.append` (base64),
 *    incluido el silencio: el VAD del servidor detecta frases y traduce solo.
 *  - Salida: `response.audio.delta` (PCM16 24 kHz base64), `response.audio_transcript.delta`
 *    / `response.text.delta` (texto traducido), `conversation.item.input_audio_transcription.delta`
 *    (texto original), `response.done` con `usage`.
 *  - Cierre correcto: `session.finish` y esperar `session.finished`; si no, se pierde la
 *    última frase y el servidor registra la sesión como error.
 *
 * Es una línea base limpia: ningún ajuste de latencia. Registra, para el diagnóstico,
 * el momento exacto de envío de cada fragmento (evento `raw` de salida), la llegada
 * del primer audio traducido, la ida y vuelta de red (ping/pong), reconexiones,
 * cierres inesperados y el consumo de tokens.
 */
export interface QwenEngineOptions extends EngineOptions {
  apiKey: string;
  /** Por defecto `qwen3.8-livetranslate-flash-realtime`. */
  model?: string;
  /** Por defecto `wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime` (Singapur). */
  url?: string;
  /** Voz de salida. Si no se indica, la que el servidor use por defecto. */
  voice?: string;
  /** Pedir audio además de texto. Por defecto sí. */
  audioOutput?: boolean;
  /** Pedir también la transcripción del idioma original. Por defecto sí. */
  inputTranscription?: boolean;
  /** Modelo de reconocimiento para la transcripción original. Por defecto `qwen3-asr-flash-realtime`. */
  transcriptionModel?: string;
  /** Tiempo máximo de espera de `session.updated` antes de enviar audio igual (ms). Por defecto 5 s. */
  readyTimeoutMs?: number;
  /** Registrar cada fragmento enviado como evento `raw` de salida (sin el audio). Por defecto sí. */
  logChunks?: boolean;
  /** Intervalo de medición de ida y vuelta con ping/pong (ms). 0 desactiva. Por defecto 15 s. */
  rttEveryMs?: number;
  /** Rotar a una sesión nueva pasado este tiempo (ms). 0 desactiva. Por defecto 110 min (límite documentado: 120 min). */
  rotateAfterMs?: number;
  /** Abrir la sesión de reemplazo con esta antelación (ms). Por defecto 90 s. */
  rotatePrepareMs?: number;
  /** Si no hay silencio, forzar la rotación pasado este margen extra (ms). Por defecto 5 min. */
  rotateForceMs?: number;
  /** Tiempo máximo que se mantiene abierta la sesión vieja para que termine de hablar (ms). Por defecto 8 s. */
  drainMs?: number;
  /** Audio que se guarda mientras se reconecta (ms). Lo que exceda se descarta. Por defecto 10 s. */
  reconnectBufferMs?: number;
  /** Umbral de silencio en dBFS para elegir el momento de rotación. Por defecto -50. */
  silenceDb?: number;
}

const DEFAULT_URL = 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime';
const DEFAULT_MODEL = 'qwen3.8-livetranslate-flash-realtime';
const DEFAULT_TRANSCRIPTION_MODEL = 'qwen3-asr-flash-realtime';

interface Session {
  id: number;
  ws: WebSocket;
  reason: string;
  connectStart: number;
  openedAt: number;
  ready: boolean;
  closedByUs: boolean;
  finishing: boolean;
  finished: boolean;
  serverId?: string;
  chunks: number;
  sentMs: number;
  firstSendAt: number;
  firstAudioAt: number;
  responses: number;
  firstError: string | null;
  onReady: (() => void) | null;
  onFinished: (() => void) | null;
}

interface Usage {
  responses: number;
  inputTokens: number;
  inputAudioTokens: number;
  outputTokens: number;
  outputAudioTokens: number;
  totalTokens: number;
}

export class QwenLiveTranslateEngine extends BaseEngine {
  readonly name = 'qwen';
  readonly inputSampleRate = 16000;
  readonly outputSampleRate = 24000;

  private active: Session | null = null;
  private standby: Session | null = null;
  private standbyOpening = false;
  private reconnecting = false;
  private stopping = false;
  private finishing = false;
  private nextId = 1;
  private nextEvent = 1;
  private quietMs = 0;
  private pending: Int16Array[] = [];
  private pendingMs = 0;
  private droppedMs = 0;
  private timers = new Set<NodeJS.Timeout>();
  private rttTimer: NodeJS.Timeout | null = null;
  private usage: Usage = { responses: 0, inputTokens: 0, inputAudioTokens: 0, outputTokens: 0, outputAudioTokens: 0, totalTokens: 0 };
  private usageReported = false;

  constructor(private readonly opts: QwenEngineOptions) {
    super();
    if (!opts.apiKey) throw new Error('Falta DASHSCOPE_API_KEY (clave de Model Studio; ver docs/qwen-livetranslate.md)');
  }

  async start(): Promise<void> {
    this.active = await this.open('inicial');
    this.emit({ type: 'ready', sessionId: this.active.serverId });
    const every = this.opts.rttEveryMs ?? 15_000;
    if (every > 0) {
      this.rttTimer = setInterval(() => {
        const s = this.active;
        if (!s || s.ws.readyState !== WebSocket.OPEN) return;
        const sent = Date.now();
        try {
          s.ws.ping();
          s.ws.once('pong', () => this.emit({ type: 'status', code: 'net.rtt', message: `Ida y vuelta de red: ${Date.now() - sent} ms`, data: { rttMs: Date.now() - sent, session: s.id } }));
        } catch {
          /* conexión cerrándose */
        }
      }, every);
    }
  }

  sendAudio(pcm: Int16Array): void {
    if (this.stopping || this.finishing) return;
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
    const timeoutMs = o.timeoutMs ?? 20_000;
    const start = Date.now();
    this.finishing = true;
    const s = this.active;
    if (s && s.ready && s.ws.readyState === WebSocket.OPEN) {
      this.flushPending(s);
      this.sendFinish(s);
      await this.waitFinished(s, timeoutMs);
      if (!s.finished) {
        this.emit({ type: 'status', code: 'session.finish_unconfirmed', message: `Qwen no confirmó \`session.finished\` en ${timeoutMs} ms (sesión #${s.id})`, data: { session: s.id, timeoutMs } });
      }
    }
    const remaining = Math.max(1000, timeoutMs - (Date.now() - start));
    await this.waitForQuiet({ quietMs: 1000, minWaitMs: 0, timeoutMs: remaining });
    this.reportUsage();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.rttTimer) clearInterval(this.rttTimer);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.reportUsage();
    const sessions = [this.active, this.standby].filter((s): s is Session => s !== null);
    this.active = null;
    this.standby = null;
    // Esperar (hasta 1 s) el evento de cierre para que quede registrado en la corrida.
    const closes = sessions.map(
      (s) =>
        new Promise<void>((resolve) => {
          if (s.ws.readyState === WebSocket.CLOSED) return resolve();
          s.ws.once('close', () => resolve());
          this.close(s);
        }),
    );
    await Promise.race([Promise.all(closes), sleep(1000)]);
  }

  // ---------------------------------------------------------------- sesión

  private sessionUpdate(): Record<string, unknown> {
    const modalities = this.opts.audioOutput === false ? ['text'] : ['text', 'audio'];
    const session: Record<string, unknown> = {
      // La documentación de 3.5 y el SDK oficial usan `modalities`; la de 3.8 nombra
      // `output_modalities`. Se mandan las dos; el eco en `session.updated` muestra cuál rige.
      modalities,
      output_modalities: modalities,
      input_audio_format: 'pcm',
      output_audio_format: 'pcm',
      translation: { language: this.opts.targetLanguage },
    };
    if (this.opts.voice) session.voice = this.opts.voice;
    if (this.opts.inputTranscription !== false) {
      session.input_audio_transcription = {
        model: this.opts.transcriptionModel ?? DEFAULT_TRANSCRIPTION_MODEL,
        ...(this.opts.sourceLanguageHint ? { language: this.opts.sourceLanguageHint } : {}),
      };
    }
    deepMerge(session, this.opts.extra);
    return { event_id: this.eventId(), type: 'session.update', session };
  }

  private eventId(): string {
    return `evt_${this.nextEvent++}`;
  }

  private open(reason: string): Promise<Session> {
    return new Promise((resolve, reject) => {
      const model = this.opts.model ?? DEFAULT_MODEL;
      const url = `${this.opts.url ?? DEFAULT_URL}?model=${encodeURIComponent(model)}`;
      const connectStart = Date.now();
      const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${this.opts.apiKey}` } });
      const s: Session = {
        id: this.nextId++,
        ws,
        reason,
        connectStart,
        openedAt: 0,
        ready: false,
        closedByUs: false,
        finishing: false,
        finished: false,
        chunks: 0,
        sentMs: 0,
        firstSendAt: 0,
        firstAudioAt: 0,
        responses: 0,
        firstError: null,
        onReady: null,
        onFinished: null,
      };
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        s.onReady = null;
        reject(err);
      };
      const succeed = (confirmed: boolean) => {
        if (settled) return;
        settled = true;
        s.onReady = null;
        s.ready = true;
        const readyMs = Date.now() - connectStart;
        this.emit({
          type: 'status',
          code: 'session.ready',
          message: confirmed ? `Sesión Qwen #${s.id} configurada (session.updated a los ${readyMs} ms de iniciar la conexión)` : `Sesión Qwen #${s.id}: sin \`session.updated\` en ${this.opts.readyTimeoutMs ?? 5000} ms; se envía audio igual`,
          data: { id: s.id, readyMs, confirmed, serverId: s.serverId },
        });
        resolve(s);
      };

      ws.on('open', () => {
        s.openedAt = Date.now();
        const connectMs = s.openedAt - connectStart;
        const update = this.sessionUpdate();
        ws.send(JSON.stringify(update));
        this.emit({ type: 'raw', direction: 'out', payload: update });
        this.emit({ type: 'status', code: 'session.opened', message: `Sesión Qwen #${s.id} abierta (${reason}, modelo ${model}, conexión ${connectMs} ms)`, data: { id: s.id, reason, model, url, connectMs } });
        s.onReady = () => succeed(true);
        const t = setTimeout(() => {
          this.timers.delete(t);
          if (settled) return;
          if (s.firstError) fail(new Error(`Qwen rechazó la configuración de la sesión #${s.id}: ${s.firstError}`));
          else succeed(false);
        }, this.opts.readyTimeoutMs ?? 5000);
        this.timers.add(t);
      });
      ws.on('unexpected-response', (_req, res: IncomingMessage) => {
        let body = '';
        res.on('data', (d) => (body += d.toString()));
        res.on('end', () => {
          const msg = `Qwen respondió HTTP ${res.statusCode} al abrir la sesión: ${body.slice(0, 500)}`;
          this.emit({ type: 'error', message: msg, fatal: true, data: { status: res.statusCode, body } });
          fail(new Error(msg));
        });
      });
      ws.on('message', (data) => this.onMessage(s, data));
      ws.on('error', (err) => {
        this.emit({ type: 'error', message: `WebSocket Qwen #${s.id}: ${err.message}`, fatal: false });
        fail(err);
      });
      ws.on('close', (code, reasonBuf) => {
        fail(new Error(`Sesión Qwen #${s.id} cerrada antes de quedar lista (código ${code})`));
        this.onClose(s, code, reasonBuf.toString());
      });
    });
  }

  private onMessage(s: Session, data: WebSocket.RawData): void {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(data.toString()) as Record<string, unknown>;
    } catch {
      this.emit({ type: 'error', message: `Mensaje no JSON de Qwen (sesión #${s.id})`, fatal: false });
      return;
    }
    const type = typeof ev.type === 'string' ? ev.type : '';
    switch (type) {
      case 'session.created': {
        const sess = ev.session as { id?: string } | undefined;
        if (sess?.id) s.serverId = sess.id;
        this.emit({ type: 'raw', direction: 'in', payload: ev });
        return;
      }
      case 'session.updated':
        this.emit({ type: 'raw', direction: 'in', payload: ev });
        s.onReady?.();
        return;
      case 'response.created':
        s.responses++;
        this.emit({ type: 'raw', direction: 'in', payload: ev });
        return;
      case 'response.audio.delta':
        if (typeof ev.delta === 'string') {
          if (!s.firstAudioAt) {
            s.firstAudioAt = Date.now();
            this.emit({
              type: 'status',
              code: 'audio.first_output',
              message: `Primer audio traducido de la sesión #${s.id}: ${s.firstAudioAt - s.openedAt} ms tras abrir, ${s.firstSendAt ? s.firstAudioAt - s.firstSendAt : -1} ms tras el primer fragmento enviado (${Math.round(s.sentMs)} ms de audio enviados)`,
              data: { session: s.id, sinceOpenMs: s.firstAudioAt - s.openedAt, sinceFirstChunkMs: s.firstSendAt ? s.firstAudioAt - s.firstSendAt : null, audioSentMs: s.sentMs },
            });
          }
          this.emit({ type: 'audio', pcm: int16FromBase64(ev.delta), sampleRate: this.outputSampleRate });
        }
        return;
      case 'response.audio_transcript.delta':
      case 'response.text.delta':
        if (typeof ev.delta === 'string') this.emit({ type: 'transcript', channel: 'target', text: ev.delta, final: false });
        return;
      case 'response.audio_transcript.text':
      case 'response.text.text':
        // Variante de 3.5: trae `delta` (incremento) o `text`/`stash` (acumulado). Solo el incremento se emite como texto.
        if (typeof ev.delta === 'string') this.emit({ type: 'transcript', channel: 'target', text: ev.delta, final: false });
        else this.emit({ type: 'raw', direction: 'in', payload: ev });
        return;
      case 'response.audio_transcript.done':
      case 'response.text.done':
        this.emit({ type: 'transcript', channel: 'target', text: String(ev.transcript ?? ev.text ?? ''), final: true });
        return;
      case 'conversation.item.input_audio_transcription.delta':
        if (typeof ev.delta === 'string') this.emit({ type: 'transcript', channel: 'source', text: ev.delta, final: false });
        return;
      case 'conversation.item.input_audio_transcription.text':
        if (typeof ev.delta === 'string') this.emit({ type: 'transcript', channel: 'source', text: ev.delta, final: false });
        else this.emit({ type: 'raw', direction: 'in', payload: ev });
        return;
      case 'conversation.item.input_audio_transcription.completed':
        this.emit({ type: 'transcript', channel: 'source', text: String(ev.transcript ?? ev.text ?? ''), final: true });
        return;
      case 'response.done':
        this.addUsage(ev);
        this.emit({ type: 'raw', direction: 'in', payload: ev });
        return;
      case 'session.finished':
        s.finished = true;
        this.emit({ type: 'status', code: 'session.finished', message: `Qwen confirmó el fin de la sesión #${s.id} (session.finished)`, data: { session: s.id } });
        s.onFinished?.();
        return;
      case 'error': {
        const e = ev.error as { code?: string; type?: string; message?: string } | undefined;
        const msg = `Qwen (sesión #${s.id}): ${e?.code ? e.code + ': ' : ''}${e?.message ?? JSON.stringify(ev)}`;
        if (!s.ready && !s.firstError) s.firstError = msg;
        this.emit({ type: 'error', message: msg, fatal: false, data: ev });
        return;
      }
    }
    // speech_started / speech_stopped / committed, response.audio.done, etc.: quedan en eventos.jsonl.
    this.emit({ type: 'raw', direction: 'in', payload: ev });
  }

  private addUsage(ev: Record<string, unknown>): void {
    const resp = ev.response as { usage?: Record<string, unknown> } | undefined;
    const u = resp?.usage ?? (ev.usage as Record<string, unknown> | undefined);
    this.usage.responses++;
    if (!u) return;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const inDet = u.input_tokens_details as Record<string, unknown> | undefined;
    const outDet = u.output_tokens_details as Record<string, unknown> | undefined;
    this.usage.inputTokens += num(u.input_tokens);
    this.usage.outputTokens += num(u.output_tokens);
    this.usage.totalTokens += num(u.total_tokens);
    this.usage.inputAudioTokens += num(inDet?.audio_tokens);
    this.usage.outputAudioTokens += num(outDet?.audio_tokens);
  }

  private reportUsage(): void {
    if (this.usageReported || this.usage.responses === 0) return;
    this.usageReported = true;
    const u = this.usage;
    this.emit({
      type: 'status',
      code: 'session.usage',
      message: `Consumo Qwen: ${u.responses} respuestas, ${u.inputTokens} tokens de entrada (${u.inputAudioTokens} de audio), ${u.outputTokens} de salida (${u.outputAudioTokens} de audio), ${u.totalTokens} en total`,
      data: { ...u },
    });
  }

  private onClose(s: Session, code: number, reason: string): void {
    s.ready = false;
    s.onReady = null;
    s.onFinished?.();
    const expected = s.closedByUs || this.stopping || s.finishing;
    this.emit({
      type: 'status',
      code: expected ? 'session.closed' : 'session.closed_unexpectedly',
      message: `Sesión Qwen #${s.id} cerrada (código ${code}${reason ? ', ' + reason : ''}${s.closedByUs ? ', por nosotros' : s.finishing ? ', tras session.finish' : ''}; ${s.chunks} fragmentos, ${Math.round(s.sentMs / 1000)} s de audio enviados, ${s.responses} respuestas)`,
      data: { id: s.id, code, reason, byUs: s.closedByUs, afterFinish: s.finishing, chunks: s.chunks, sentMs: s.sentMs, responses: s.responses },
    });
    if (this.standby === s) this.standby = null;
    if (this.active === s) {
      this.active = null;
      if (!expected) void this.reconnect();
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
    const now = Date.now();
    if (!s.firstSendAt) s.firstSendAt = now;
    const ms = samplesToMs(pcm.length, this.inputSampleRate);
    s.chunks++;
    s.sentMs += ms;
    s.ws.send(JSON.stringify({ event_id: this.eventId(), type: 'input_audio_buffer.append', audio: base64FromInt16(pcm) }));
    if (this.opts.logChunks !== false) {
      this.emit({ type: 'raw', direction: 'out', payload: { type: 'input_audio_buffer.append', session: s.id, seq: s.chunks, ms, audioMs: Math.round(s.sentMs), sentAt: now } });
    }
  }

  private sendFinish(s: Session): void {
    if (s.finishing || s.ws.readyState !== WebSocket.OPEN) return;
    s.finishing = true;
    const msg = { event_id: this.eventId(), type: 'session.finish' };
    s.ws.send(JSON.stringify(msg));
    this.emit({ type: 'raw', direction: 'out', payload: { ...msg, session: s.id, sentAt: Date.now() } });
  }

  private waitFinished(s: Session, timeoutMs: number): Promise<void> {
    if (s.finished || s.ws.readyState !== WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        s.onFinished = null;
        resolve();
      }, timeoutMs);
      this.timers.add(t);
      s.onFinished = () => {
        clearTimeout(t);
        this.timers.delete(t);
        s.onFinished = null;
        resolve();
      };
    });
  }

  // ------------------------------------------------------------- rotación

  private trackQuiet(pcm: Int16Array): void {
    const ms = samplesToMs(pcm.length, this.inputSampleRate);
    this.quietMs = dbfs(pcm) < (this.opts.silenceDb ?? -50) ? this.quietMs + ms : 0;
  }

  private maybeRotate(): void {
    const rotateAfter = this.opts.rotateAfterMs ?? 110 * 60_000;
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
    // La sesión vieja termina con `session.finish` para no perder su última frase.
    this.sendFinish(old);
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.close(old);
    }, this.opts.drainMs ?? 8000);
    this.timers.add(t);
    old.onFinished = () => {
      clearTimeout(t);
      this.timers.delete(t);
      old.onFinished = null;
      this.close(old);
    };
  }

  // ----------------------------------------------------------- reconexión

  private async reconnect(): Promise<void> {
    if (this.reconnecting || this.stopping || this.finishing) return;
    this.reconnecting = true;
    this.emit({ type: 'status', code: 'session.reconnecting', message: 'Reconectando con Qwen' });
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
          this.emit({ type: 'error', message: `Reconexión con Qwen fallida tras ${attempt} intentos: ${(err as Error).message}`, fatal: true });
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
