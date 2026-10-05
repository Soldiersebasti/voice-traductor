import { createWriteStream, mkdirSync, writeFileSync, type WriteStream } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createEngine, readWav, resampleLinear, sleep, toMono, WavWriter, type EngineEvent, type TranslationEngine } from '@voice-traductor/engines';
import { encodeMp3, ffmpegAvailable, loadAudioAtRate } from './audio-load.js';
import { computeMetrics, type ChunkRec, type Metrics, type StatusRec, type TranscriptRec } from './metrics.js';
import { detectPhrasesByVad, loadManifest, loadPhraseList, type PhraseSpec } from './phrases.js';
import { renderSummary } from './summary.js';
import { fmtClock, timestampLabel } from './util.js';

export interface RunConfig {
  engines: string[];
  input: string;
  outDir: string;
  /** Etiqueta base de la corrida. A cada motor se le agrega su nombre. */
  label?: string;
  targetLanguage: string;
  sourceLanguageHint?: string;
  chunkMs?: number;
  /** Recortar la fuente a este máximo de minutos. */
  maxMinutes?: number;
  startMs?: number;
  /** Opciones por motor: plano (aplica a todos) o con claves por nombre de motor. */
  engineOptions?: Record<string, unknown>;
  mp3?: boolean;
  finishTimeoutMs?: number;
  vadThresholdDb?: number;
  /** Umbral de latencia del MVP (ms). Por defecto 3000. */
  thresholdMs?: number;
  /** Manifiesto de frases interactivas con tiempos exactos (generado por `phrases`). */
  manifest?: string;
  /** Guion de frases interactivas grabado con voz propia: se detectan por silencio y se emparejan en orden. */
  phrasesFile?: string;
  progressEveryMs?: number;
  log?: (line: string) => void;
  signal?: AbortSignal;
}

export interface RunResult {
  engine: string;
  dir: string;
  metrics: Metrics;
}

/** Estado y archivos de salida de un motor dentro de una corrida. */
class EngineRun {
  readonly chunks: ChunkRec[] = [];
  readonly transcripts: TranscriptRec[] = [];
  readonly statuses: StatusRec[] = [];
  cursorMs = 0;
  lastPlayStart = 0;
  targetText = '';
  sourceText = '';
  private readonly aligned: WavWriter;
  private readonly raw: WavWriter;
  private readonly events: WriteStream;
  private readonly timedTarget: WriteStream;
  private unsub: (() => void) | null = null;
  fatal: string | null = null;

  constructor(
    readonly engine: TranslationEngine,
    readonly dir: string,
    readonly label: string,
    private readonly now: () => number,
    private readonly log: (line: string) => void,
  ) {
    mkdirSync(dir, { recursive: true });
    this.aligned = new WavWriter(join(dir, 'traduccion_alineada.wav'), engine.outputSampleRate);
    this.raw = new WavWriter(join(dir, 'traduccion_cruda.wav'), engine.outputSampleRate);
    this.events = createWriteStream(join(dir, 'eventos.jsonl'));
    this.timedTarget = createWriteStream(join(dir, 'transcripcion_traduccion.jsonl'));
  }

  attach(): void {
    this.unsub = this.engine.on((ev) => this.onEvent(ev));
  }

  detach(): void {
    this.unsub?.();
    this.unsub = null;
  }

  private onEvent(ev: EngineEvent): void {
    const t = this.now();
    switch (ev.type) {
      case 'audio': {
        const rate = this.engine.outputSampleRate;
        const pcm = ev.sampleRate === rate ? ev.pcm : resampleLinear(ev.pcm, ev.sampleRate, rate);
        // Simulación de reproductor: lo que llega se reproduce en cuanto termina lo anterior.
        const playStart = Math.max(this.cursorMs, t);
        if (playStart > this.cursorMs) this.aligned.writeSilence(Math.round(((playStart - this.cursorMs) / 1000) * rate));
        this.aligned.write(pcm);
        this.raw.write(pcm);
        const durMs = (pcm.length / rate) * 1000;
        this.cursorMs = playStart + durMs;
        this.lastPlayStart = playStart;
        this.chunks.push({ t, playStart, playEnd: this.cursorMs, samples: pcm.length });
        this.events.write(JSON.stringify({ t: r1(t), type: 'audio', samples: pcm.length, playStart: r1(playStart) }) + '\n');
        return;
      }
      case 'transcript': {
        const rec: TranscriptRec = { t, playRef: this.lastPlayStart, channel: ev.channel, text: ev.text, final: ev.final };
        this.transcripts.push(rec);
        if (!ev.final) {
          if (ev.channel === 'target') {
            this.targetText += ev.text;
            this.timedTarget.write(JSON.stringify({ t: r1(t), playRef: r1(this.lastPlayStart), text: ev.text }) + '\n');
          } else this.sourceText += ev.text;
        }
        this.events.write(JSON.stringify({ t: r1(t), type: 'transcript', channel: ev.channel, final: ev.final, text: ev.text }) + '\n');
        return;
      }
      case 'status':
      case 'error':
      case 'closed':
      case 'ready': {
        const rec: StatusRec = {
          t,
          kind: ev.type,
          code: ev.type === 'status' ? ev.code : ev.type === 'closed' ? 'closed' : undefined,
          message: ev.type === 'status' || ev.type === 'error' ? ev.message : ev.type === 'closed' ? `Cerrado (${ev.code ?? ''} ${ev.reason ?? ''})`.trim() : 'listo',
          data: ev.type === 'status' || ev.type === 'error' ? ev.data : undefined,
        };
        this.statuses.push(rec);
        this.events.write(JSON.stringify({ t: r1(t), type: ev.type, code: rec.code, message: rec.message, data: safeData(rec.data) }) + '\n');
        if (ev.type === 'error' && ev.fatal) this.fatal = ev.message;
        if (ev.type !== 'ready') this.log(`[${fmtClock(t)}] ${this.engine.name}: ${rec.message}`);
        return;
      }
      case 'raw':
        this.events.write(JSON.stringify({ t: r1(t), type: 'raw', direction: ev.direction, payload: safeData(ev.payload) }) + '\n');
        return;
    }
  }

  async finalize(o: { source: Int16Array; sourceRate: number; sourceEndMs: number; runEndMs: number; vadThresholdDb?: number; thresholdMs?: number; phrases?: PhraseSpec[]; mp3: boolean; config: unknown }): Promise<Metrics> {
    this.detach();
    this.aligned.close();
    this.raw.close();
    await Promise.all([endStream(this.events), endStream(this.timedTarget)]);
    writeFileSync(join(this.dir, 'transcripcion_traduccion.txt'), this.targetText.trim() + '\n');
    writeFileSync(join(this.dir, 'transcripcion_original.txt'), this.sourceText.trim() + '\n');

    const output = toMono(readWav(this.aligned.path));
    writeComparison(join(this.dir, 'comparacion.wav'), o.source, o.sourceRate, output, this.engine.outputSampleRate);

    const metrics = computeMetrics({
      engine: this.engine.name,
      label: this.label,
      source: o.source,
      sourceRate: o.sourceRate,
      output,
      outputRate: this.engine.outputSampleRate,
      chunks: this.chunks,
      transcripts: this.transcripts,
      statuses: this.statuses,
      sourceEndMs: o.sourceEndMs,
      runEndMs: o.runEndMs,
      vadThresholdDb: o.vadThresholdDb,
      thresholdMs: o.thresholdMs,
      phrases: o.phrases,
    });
    writeFileSync(join(this.dir, 'metricas.json'), JSON.stringify(metrics, null, 2));
    writeFileSync(join(this.dir, 'resumen.md'), renderSummary(metrics, { fatal: this.fatal }));
    writeFileSync(join(this.dir, 'corrida.json'), JSON.stringify({ ...(o.config as object), engine: this.engine.name, label: this.label, finishedAt: new Date().toISOString(), fatal: this.fatal }, null, 2));

    if (o.mp3) {
      try {
        await encodeMp3(join(this.dir, 'comparacion.wav'), join(this.dir, 'comparacion.mp3'));
        await encodeMp3(join(this.dir, 'traduccion_cruda.wav'), join(this.dir, 'traduccion_cruda.mp3'));
      } catch (err) {
        this.log(`No se pudo generar mp3: ${(err as Error).message}`);
      }
    }
    return metrics;
  }
}

export async function runBench(cfg: RunConfig): Promise<RunResult[]> {
  const log = cfg.log ?? ((l: string) => console.log(l));
  const chunkMs = cfg.chunkMs ?? 100;
  const baseLabel = cfg.label ?? `${timestampLabel()}-${basename(cfg.input, extname(cfg.input))}`;

  const engines = cfg.engines.map((name) =>
    createEngine(name, {
      targetLanguage: cfg.targetLanguage,
      sourceLanguageHint: cfg.sourceLanguageHint,
      engineOptions: pickEngineOptions(cfg.engineOptions, name, cfg.engines),
    }),
  );

  // Una copia de la fuente por cada tasa de entrada distinta.
  const sources = new Map<number, Int16Array>();
  for (const e of engines) {
    if (sources.has(e.inputSampleRate)) continue;
    log(`Cargando ${cfg.input} a ${e.inputSampleRate} Hz...`);
    sources.set(e.inputSampleRate, await loadAudioAtRate(cfg.input, e.inputSampleRate, { maxMs: cfg.maxMinutes ? cfg.maxMinutes * 60_000 : undefined, startMs: cfg.startMs, log }));
  }
  const anyRate = engines[0].inputSampleRate;
  const sourceDurationMs = (sources.get(anyRate)!.length / anyRate) * 1000;
  let phrases: PhraseSpec[] | undefined;
  if (cfg.manifest) {
    phrases = loadManifest(cfg.manifest).phrases.filter((p) => p.endMs <= sourceDurationMs);
    log(`Prueba interactiva: ${phrases.length} frases del manifiesto ${cfg.manifest}.`);
  } else if (cfg.phrasesFile) {
    const texts = loadPhraseList(cfg.phrasesFile);
    phrases = detectPhrasesByVad(sources.get(anyRate)!, anyRate, texts, { thresholdDb: cfg.vadThresholdDb });
    log(`Prueba interactiva: ${phrases.length} frases detectadas por silencio en la grabación (${texts.length} en el guion).`);
    if (phrases.length !== texts.length) log('Aviso: el número de frases detectadas no coincide con el guion; revisar que haya al menos 1,5 s de silencio entre frases.');
  }
  log(`Fuente: ${fmtClock(sourceDurationMs)} de audio. Motores: ${engines.map((e) => e.name).join(', ')}. Destino: ${cfg.targetLanguage}.`);

  const mp3 = Boolean(cfg.mp3) && (await ffmpegAvailable());
  const t0 = performance.now();
  const now = () => performance.now() - t0;
  const runs = engines.map((e) => new EngineRun(e, join(cfg.outDir, `${baseLabel}-${e.name}`), `${baseLabel}-${e.name}`, now, log));
  for (const r of runs) r.attach();

  await Promise.all(
    runs.map((r) =>
      r.engine.start().catch((err: Error) => {
        r.fatal = `No arrancó: ${err.message}`;
        log(`${r.engine.name}: ${r.fatal}`);
      }),
    ),
  );
  if (runs.every((r) => r.fatal)) {
    for (const r of runs) r.detach();
    await Promise.all(runs.map((r) => r.engine.stop()));
    throw new Error(`Ningún motor pudo arrancar: ${runs.map((r) => `${r.engine.name}: ${r.fatal}`).join(' | ')}`);
  }
  log(`Motores listos: ${runs.filter((r) => !r.fatal).map((r) => r.engine.name).join(', ')}. Reproduciendo en tiempo real... (Ctrl+C termina antes y guarda lo que haya)`);

  const tStart = now();
  const nChunks = Math.ceil(sourceDurationMs / chunkMs);
  const chunkSamples = new Map([...sources.keys()].map((rate) => [rate, Math.round((rate * chunkMs) / 1000)]));
  let nextProgress = cfg.progressEveryMs ?? 30_000;
  let sent = 0;
  for (let i = 0; i < nChunks; i++) {
    if (cfg.signal?.aborted) {
      log('Interrumpido: se detiene la reproducción.');
      break;
    }
    if (runs.every((r) => r.fatal)) {
      log('Todos los motores reportaron un error fatal: se detiene la reproducción.');
      break;
    }
    const due = tStart + i * chunkMs;
    const wait = due - now();
    if (wait > 1) await sleep(wait);
    for (const r of runs) {
      if (r.fatal) continue;
      const rate = r.engine.inputSampleRate;
      const n = chunkSamples.get(rate)!;
      const src = sources.get(rate)!;
      const start = i * n;
      if (start >= src.length) continue;
      let chunk = src.subarray(start, Math.min(src.length, start + n));
      if (chunk.length < n) {
        const padded = new Int16Array(n);
        padded.set(chunk);
        chunk = padded;
      }
      r.engine.sendAudio(chunk);
    }
    sent = (i + 1) * chunkMs;
    if (sent >= nextProgress) {
      nextProgress += cfg.progressEveryMs ?? 30_000;
      for (const r of runs) {
        const tail = r.targetText.trim().slice(-80).replace(/\s+/g, ' ');
        log(`[${fmtClock(now())}] ${r.engine.name}: fuente ${fmtClock(sent)} | reproducido hasta ${fmtClock(r.cursorMs)} | ${r.chunks.length} fragmentos | "${tail}"`);
      }
    }
  }
  const sourceEndMs = Math.min(sent, sourceDurationMs);
  log(`Fin del audio fuente (${fmtClock(sourceEndMs)}). Esperando que los motores terminen de hablar...`);
  await Promise.all(runs.map((r) => (r.fatal ? Promise.resolve() : r.engine.finish({ timeoutMs: cfg.finishTimeoutMs }))));
  const runEndMs = now();
  await Promise.all(runs.map((r) => r.engine.stop()));

  const results: RunResult[] = [];
  const config = { input: cfg.input, targetLanguage: cfg.targetLanguage, sourceLanguageHint: cfg.sourceLanguageHint, chunkMs, maxMinutes: cfg.maxMinutes, startMs: cfg.startMs, engineOptions: cfg.engineOptions, thresholdMs: cfg.thresholdMs ?? 3000, manifest: cfg.manifest, phrasesFile: cfg.phrasesFile, startedAt: new Date(Date.now() - runEndMs).toISOString() };
  for (const r of runs) {
    log(`Calculando métricas de ${r.engine.name}...`);
    const metrics = await r.finalize({ source: sources.get(r.engine.inputSampleRate)!, sourceRate: r.engine.inputSampleRate, sourceEndMs, runEndMs, vadThresholdDb: cfg.vadThresholdDb, thresholdMs: cfg.thresholdMs, phrases, mp3, config });
    results.push({ engine: r.engine.name, dir: r.dir, metrics });
  }
  return results;
}

function pickEngineOptions(all: Record<string, unknown> | undefined, name: string, names: string[]): Record<string, unknown> | undefined {
  if (!all) return undefined;
  const keyed = names.some((n) => n in all);
  if (!keyed) return all;
  return (all[name] as Record<string, unknown> | undefined) ?? undefined;
}

/** Archivo estéreo: izquierda = original, derecha = traducción tal como se oiría. */
export function writeComparison(path: string, source: Int16Array, sourceRate: number, output: Int16Array, outRate: number): void {
  const src = resampleLinear(source, sourceRate, outRate);
  const frames = Math.max(src.length, output.length);
  const w = new WavWriter(path, outRate, 2);
  const block = 1 << 18;
  const inter = new Int16Array(block * 2);
  for (let pos = 0; pos < frames; pos += block) {
    const n = Math.min(block, frames - pos);
    for (let i = 0; i < n; i++) {
      inter[i * 2] = src[pos + i] ?? 0;
      inter[i * 2 + 1] = output[pos + i] ?? 0;
    }
    w.write(n === block ? inter : inter.subarray(0, n * 2));
  }
  w.close();
}

function endStream(s: WriteStream): Promise<void> {
  return new Promise((resolve) => s.end(resolve));
}

function r1(v: number): number {
  return Math.round(v * 10) / 10;
}

function safeData(v: unknown): unknown {
  if (v === undefined) return undefined;
  try {
    const s = JSON.stringify(v);
    return s.length > 4000 ? { truncated: s.slice(0, 4000) } : v;
  } catch {
    return String(v);
  }
}
