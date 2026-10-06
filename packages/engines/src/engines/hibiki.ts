import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { BaseEngine } from '../base.js';
import type { EngineOptions } from '../types.js';
import { base64FromInt16, int16FromBase64, msToSamples, samplesToMs, silence, sleep } from '../audio/pcm.js';

/**
 * Adaptador para Hibiki-Zero (Kyutai) a través de `hibiki-zero serve` y el
 * puente `tools/hibiki_bridge.py`.
 *
 * `hibiki-zero serve` habla el protocolo de Moshi por WebSocket (audio Opus
 * con prefijo de byte). El puente, escrito en Python con las mismas librerías
 * que el cliente oficial, traduce eso a JSON con PCM16 en base64, que es lo
 * que este adaptador consume. Así la cadena de medición es idéntica a la de
 * OpenAI: audio enviado cada 100 ms en tiempo real, salida reproducida según
 * llega, mismos eventos y marcas de tiempo.
 *
 * Hibiki-Zero traduce francés, español, portugués y alemán a inglés; detecta
 * el idioma de entrada solo. Entrada y salida a 24 kHz (tasa de Mimi).
 */
export interface HibikiEngineOptions extends EngineOptions {
  /** WebSocket del puente. Por defecto ws://127.0.0.1:8999 */
  bridgeUrl?: string;
  /** WebSocket de `hibiki-zero serve`, que el puente abre por nosotros. Por defecto ws://127.0.0.1:8998/api/chat */
  upstreamUrl?: string;
  /** Lanzar el puente como proceso hijo con `python`. Por defecto no: se espera un puente ya corriendo (por ejemplo dentro de WSL). */
  autostart?: boolean;
  /** Intérprete de Python con hibiki-zero instalado, si autostart. Por defecto `python`. */
  python?: string;
  /** Ruta al puente. Por defecto tools/hibiki_bridge.py del repositorio. */
  bridgeScript?: string;
  /** Si Hibiki cierra la sesión a mitad de corrida, abrir otra y seguir (cuenta como reconexión). Por defecto sí. */
  reconnect?: boolean;
  /** Audio que se guarda mientras se reconecta (ms). Por defecto 10 s. */
  reconnectBufferMs?: number;
  /** Silencio que se envía al final, al ritmo real, para que el modelo termine la última frase (ms). Por defecto 6 s. */
  tailMs?: number;
  /** Espera máxima al saludo de Hibiki (ms). Por defecto 60 s. */
  readyTimeoutMs?: number;
}

const DEFAULT_BRIDGE = 'ws://127.0.0.1:8999';
const DEFAULT_UPSTREAM = 'ws://127.0.0.1:8998/api/chat';

export class HibikiEngine extends BaseEngine {
  readonly name = 'hibiki';
  readonly inputSampleRate = 24000;
  readonly outputSampleRate = 24000;

  private ws: WebSocket | null = null;
  private child: ChildProcess | null = null;
  private ready = false;
  private stopping = false;
  private reconnecting = false;
  private sessions = 0;
  private pending: Int16Array[] = [];
  private pendingMs = 0;
  private droppedMs = 0;
  private readyWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];

  constructor(private readonly opts: HibikiEngineOptions) {
    super();
    if ((opts.targetLanguage ?? 'en').toLowerCase().slice(0, 2) !== 'en') {
      throw new Error(`Hibiki-Zero solo traduce a inglés; se pidió "${opts.targetLanguage}"`);
    }
  }

  async start(): Promise<void> {
    if (this.opts.autostart) await this.spawnBridge();
    await this.connectBridge();
    await this.openSession('inicial');
    this.emit({ type: 'ready' });
  }

  sendAudio(pcm: Int16Array): void {
    if (this.stopping) return;
    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.enqueue(pcm);
      return;
    }
    this.flushPending();
    this.sendChunk(pcm);
  }

  async finish(o: { timeoutMs?: number } = {}): Promise<void> {
    // Hibiki solo avanza cuando recibe audio: se envía silencio al ritmo real
    // hasta que termine de hablar o se agote la cola de silencio.
    const tailMs = this.opts.tailMs ?? 6000;
    const chunk = silence(msToSamples(100, this.inputSampleRate));
    let sentMs = 0;
    const timer = setInterval(() => {
      if (sentMs >= tailMs || !this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.sendChunk(chunk);
      sentMs += 100;
    }, 100);
    try {
      await this.waitForQuiet({ quietMs: 2500, minWaitMs: 2000, timeoutMs: o.timeoutMs ?? 20000 });
    } finally {
      clearInterval(timer);
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.ready = false;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'end' }));
        this.ws.close(1000, 'bye');
      } catch {
        /* ya cerrado */
      }
    }
    this.ws = null;
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }

  // ------------------------------------------------------------- puente

  private async spawnBridge(): Promise<void> {
    const script = this.opts.bridgeScript ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../../tools/hibiki_bridge.py');
    if (!existsSync(script)) throw new Error(`No se encuentra el puente ${script}`);
    const url = new URL(this.opts.bridgeUrl ?? DEFAULT_BRIDGE);
    const listen = `${url.hostname}:${url.port || '8999'}`;
    const python = this.opts.python ?? 'python';
    this.child = spawn(python, [script, '--listen', listen, '--upstream', this.opts.upstreamUrl ?? DEFAULT_UPSTREAM], { stdio: ['ignore', 'ignore', 'pipe'] });
    this.child.stderr?.on('data', (d: Buffer) => this.emit({ type: 'status', code: 'bridge.log', message: d.toString().trim().slice(0, 300) }));
    this.child.on('exit', (code) => {
      if (!this.stopping) this.emit({ type: 'error', message: `El puente de Hibiki terminó (código ${code}). ¿Está instalado hibiki-zero en "${python}"?`, fatal: !this.ready });
    });
    await sleep(500);
  }

  private connectBridge(): Promise<void> {
    const url = this.opts.bridgeUrl ?? DEFAULT_BRIDGE;
    const attempts = this.opts.autostart ? 40 : 3;
    return new Promise((resolve, reject) => {
      let attempt = 0;
      const tryOnce = () => {
        attempt++;
        const ws = new WebSocket(url);
        ws.on('open', () => {
          this.ws = ws;
          ws.on('message', (data) => this.onMessage(data));
          ws.on('close', (code, reason) => this.onBridgeClose(code, reason.toString()));
          ws.on('error', (err) => this.emit({ type: 'error', message: `WebSocket del puente: ${err.message}`, fatal: false }));
          resolve();
        });
        ws.on('error', (err) => {
          ws.removeAllListeners();
          if (attempt < attempts) setTimeout(tryOnce, 500);
          else reject(new Error(`No se pudo conectar al puente de Hibiki en ${url}: ${err.message}. Arrancar \`python tools/hibiki_bridge.py\` en el entorno donde está hibiki-zero (o usar autostart).`));
        });
      };
      tryOnce();
    });
  }

  private openSession(reason: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error('El puente no está conectado'));
      this.sessions++;
      this.ready = false;
      const timeout = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((w) => w.resolve !== ok);
        reject(new Error(`Hibiki no respondió el saludo en ${this.opts.readyTimeoutMs ?? 60_000} ms. ¿Está corriendo \`hibiki-zero serve\`? ¿Hay otra pestaña o cliente conectado? Atiende uno a la vez.`));
      }, this.opts.readyTimeoutMs ?? 60_000);
      const ok = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.readyWaiters.push({ resolve: ok, reject: (e) => { clearTimeout(timeout); reject(e); } });
      const msg = { type: 'start', upstream: this.opts.upstreamUrl ?? DEFAULT_UPSTREAM };
      ws.send(JSON.stringify(msg));
      this.emit({ type: 'raw', direction: 'out', payload: msg });
      this.emit({ type: 'status', code: 'session.opened', message: `Sesión Hibiki #${this.sessions} solicitada (${reason})`, data: { id: this.sessions, reason } });
    });
  }

  private onMessage(data: WebSocket.RawData): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data.toString()) as Record<string, unknown>;
    } catch {
      this.emit({ type: 'error', message: 'Mensaje no JSON del puente de Hibiki', fatal: false });
      return;
    }
    switch (msg.type) {
      case 'ready': {
        this.ready = true;
        const waiters = this.readyWaiters;
        this.readyWaiters = [];
        for (const w of waiters) w.resolve();
        this.emit({ type: 'status', code: 'session.ready', message: `Hibiki #${this.sessions} lista`, data: { id: this.sessions } });
        this.flushPending();
        return;
      }
      case 'audio':
        if (typeof msg.pcm === 'string') this.emit({ type: 'audio', pcm: int16FromBase64(msg.pcm), sampleRate: this.outputSampleRate });
        return;
      case 'text':
        this.emit({ type: 'transcript', channel: 'target', text: String(msg.text ?? ''), final: false });
        return;
      case 'status':
        this.emit({ type: 'status', code: String(msg.code ?? 'bridge'), message: String(msg.message ?? ''), data: msg.data });
        return;
      case 'error': {
        const fatal = Boolean(msg.fatal);
        this.emit({ type: 'error', message: `Hibiki: ${String(msg.message ?? '')}`, fatal, data: msg });
        if (fatal) {
          const waiters = this.readyWaiters;
          this.readyWaiters = [];
          for (const w of waiters) w.reject(new Error(String(msg.message ?? 'error fatal del puente')));
        }
        return;
      }
      case 'closed': {
        const wasReady = this.ready;
        this.ready = false;
        const unexpected = !this.stopping;
        this.emit({ type: 'status', code: unexpected ? 'session.closed_unexpectedly' : 'session.closed', message: `Hibiki cerró la sesión #${this.sessions} (${String(msg.reason ?? '')}, código ${String(msg.code ?? '-')})`, data: msg.data });
        if (unexpected && wasReady && this.opts.reconnect !== false) void this.reconnect();
        return;
      }
      case 'pong':
        return;
      default:
        this.emit({ type: 'raw', direction: 'in', payload: msg });
    }
  }

  private onBridgeClose(code: number, reason: string): void {
    this.ready = false;
    if (this.stopping) return;
    this.emit({ type: 'error', message: `El puente de Hibiki cerró la conexión (código ${code}${reason ? ', ' + reason : ''})`, fatal: true });
  }

  private async reconnect(): Promise<void> {
    if (this.reconnecting || this.stopping) return;
    this.reconnecting = true;
    this.emit({ type: 'status', code: 'session.reconnecting', message: 'Abriendo una sesión nueva con Hibiki' });
    let attempt = 0;
    while (!this.stopping) {
      try {
        await this.openSession('reconexión');
        this.emit({ type: 'status', code: 'session.reconnected', message: `Sesión Hibiki #${this.sessions} abierta tras ${attempt + 1} intento(s)`, data: { id: this.sessions, attempts: attempt + 1 } });
        break;
      } catch (err) {
        attempt++;
        if (attempt > 5) {
          this.emit({ type: 'error', message: `Reconexión con Hibiki fallida tras ${attempt} intentos: ${(err as Error).message}`, fatal: true });
          break;
        }
        await sleep(Math.min(8000, 500 * 2 ** attempt));
      }
    }
    this.reconnecting = false;
  }

  private sendChunk(pcm: Int16Array): void {
    this.ws?.send(JSON.stringify({ type: 'audio', pcm: base64FromInt16(pcm) }));
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

  private flushPending(): void {
    if (!this.ready || (this.pending.length === 0 && this.droppedMs === 0)) return;
    const sent = this.pendingMs;
    for (const p of this.pending) this.sendChunk(p);
    this.pending = [];
    this.pendingMs = 0;
    this.emit({ type: 'status', code: 'audio.buffered_flush', message: `Se enviaron ${Math.round(sent)} ms de audio guardados durante la reconexión; ${Math.round(this.droppedMs)} ms descartados`, data: { sentMs: sent, droppedMs: this.droppedMs } });
    this.droppedMs = 0;
  }
}
