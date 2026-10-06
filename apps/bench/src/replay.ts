import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readWav, readWavHeader, toMono, WavWriter } from '@voice-traductor/engines';
import { atempo, ffmpegAvailable, loadAudioAtRate } from './audio-load.js';
import { loadChunks, type ChunkEntry } from './judge.js';
import { computeMetrics, type Metrics } from './metrics.js';
import { writeComparison } from './run.js';
import { renderSummary } from './summary.js';
import { fmtClock, fmtSec } from './util.js';
import { detectSpeech } from './vad.js';

/**
 * Simulación "qué pasaría" sin volver a llamar al modelo: vuelve a reproducir
 * el audio traducido que ya llegó, con las mismas horas de llegada, pero con un
 * reproductor que, cuando lleva acumulado más de `triggerMs` de cola, recorta
 * las pausas del modelo y reproduce un poco más rápido conservando el tono.
 * No se pierde ninguna palabra ni se corta ninguna frase: solo se acorta el
 * tiempo de escucha, como hace un intérprete humano cuando se queda atrás.
 */
export interface ReplayOptions {
  runDir: string;
  outDir?: string;
  /** Cola a partir de la cual se activa el alcance (ms). Por defecto 2500. */
  triggerMs?: number;
  /** Factor de velocidad cuando hay que alcanzar. Por defecto 1.15. */
  stretch?: number;
  /** Recortar pausas del modelo mayores a 250 ms a 120 ms mientras hay que alcanzar. Por defecto sí. */
  trimSilence?: boolean;
  log?: (line: string) => void;
}

export interface ReplayResult {
  dir: string;
  metrics: Metrics;
  stretchedMs: number;
  trimmedMs: number;
  listeningMsBefore: number;
  listeningMsAfter: number;
}

interface Burst {
  tStart: number;
  rawStartMs: number;
  rawMs: number;
  pcm: Int16Array;
}

export async function replayRun(o: ReplayOptions): Promise<ReplayResult> {
  const log = o.log ?? (() => {});
  const triggerMs = o.triggerMs ?? 2500;
  const stretch = o.stretch ?? 1.15;
  const trim = o.trimSilence !== false;
  const chunks = loadChunks(o.runDir);
  if (!chunks.length) throw new Error(`No hay fragmentos de audio en ${join(o.runDir, 'eventos.jsonl')}`);
  const rawPath = join(o.runDir, 'traduccion_cruda.wav');
  if (!existsSync(rawPath)) throw new Error(`No existe ${rawPath}`);
  const rate = readWavHeader(rawPath).sampleRate;
  const raw = toMono(readWav(rawPath));
  const corrida = JSON.parse(readFileSync(join(o.runDir, 'corrida.json'), 'utf8')) as { input: string; engine: string; thresholdMs?: number; label?: string };
  const canStretch = stretch !== 1 && (await ffmpegAvailable());
  if (stretch !== 1 && !canStretch) log('Aviso: sin ffmpeg no se puede acelerar; solo se recortan pausas.');

  // Ráfagas: fragmentos que llegaron seguidos (< 300 ms) forman una emisión del modelo.
  const bursts: Burst[] = [];
  let rawPos = 0;
  let lastT = -Infinity;
  for (const c of chunks) {
    const ms = (c.samples / rate) * 1000;
    const slice = raw.subarray(Math.round((rawPos / 1000) * rate), Math.round(((rawPos + ms) / 1000) * rate));
    const last = bursts[bursts.length - 1];
    if (last && c.t - lastT < 300) {
      const merged = new Int16Array(last.pcm.length + slice.length);
      merged.set(last.pcm);
      merged.set(slice, last.pcm.length);
      last.pcm = merged;
      last.rawMs += ms;
    } else bursts.push({ tStart: c.t, rawStartMs: rawPos, rawMs: ms, pcm: slice });
    lastT = c.t;
    rawPos += ms;
  }

  const dir = o.outDir ?? `${o.runDir.replace(/[\\/]+$/, '')}-replay-${stretch.toFixed(2)}x`;
  mkdirSync(dir, { recursive: true });
  const aligned = new WavWriter(join(dir, 'traduccion_alineada.wav'), rate);
  const events = createWriteStream(join(dir, 'eventos.jsonl'));
  const entries: ChunkEntry[] = [];
  let cursor = 0;
  let stretchedMs = 0;
  let trimmedMs = 0;
  for (const b of bursts) {
    const backlog = Math.max(0, cursor - b.tStart);
    const catchUp = backlog > triggerMs;
    let pcm = b.pcm;
    const before = (pcm.length / rate) * 1000;
    if (catchUp && trim) {
      const t = trimPauses(pcm, rate);
      trimmedMs += before - (t.length / rate) * 1000;
      pcm = t;
    }
    if (catchUp && canStretch) {
      const s = await atempo(pcm, rate, stretch);
      stretchedMs += (pcm.length / rate) * 1000;
      pcm = s;
    }
    const playStart = Math.max(cursor, b.tStart);
    if (playStart > cursor) aligned.writeSilence(Math.round(((playStart - cursor) / 1000) * rate));
    aligned.write(pcm);
    const playedMs = (pcm.length / rate) * 1000;
    cursor = playStart + playedMs;
    const entry: ChunkEntry = { t: b.tStart, samples: pcm.length, playStart, rawStartMs: b.rawStartMs, rawMs: b.rawMs };
    entries.push(entry);
    events.write(JSON.stringify({ t: r1(b.tStart), type: 'audio', samples: pcm.length, playStart: r1(playStart), rawStartMs: r1(b.rawStartMs), rawMs: r1(b.rawMs), factor: catchUp && canStretch ? stretch : 1, trimmed: catchUp && trim }) + '\n');
  }
  events.write(JSON.stringify({ t: 0, type: 'status', code: 'replay', message: `Simulación: alcance a partir de ${triggerMs} ms de cola, velocidad ${stretch}x, recorte de pausas ${trim ? 'sí' : 'no'}` }) + '\n');
  aligned.close();
  await new Promise<void>((resolve) => events.end(resolve));
  copyFileSync(rawPath, join(dir, 'traduccion_cruda.wav'));
  for (const f of ['transcripcion_traduccion.txt', 'transcripcion_original.txt', 'transcripcion_traduccion.jsonl']) if (existsSync(join(o.runDir, f))) copyFileSync(join(o.runDir, f), join(dir, f));

  const originalCursor = chunks.reduce((a, c) => Math.max(a, c.playStart + (c.samples / rate) * 1000), 0);
  log(`Escucha original hasta ${fmtClock(originalCursor)}; simulada hasta ${fmtClock(cursor)}. Acelerado ${fmtSec(stretchedMs, 1)}, pausas recortadas ${fmtSec(trimmedMs, 1)}.`);

  // Métricas con la misma fuente de la corrida original.
  const srcRate = corrida.engine === 'gemini' ? 16000 : corrida.engine === 'mock' ? 16000 : 24000;
  const maxMs = Math.max(cursor, originalCursor) + 1000;
  const source = await loadAudioAtRate(corrida.input, srcRate, { maxMs, log });
  const sourceEndMs = (source.length / srcRate) * 1000;
  const output = toMono(readWav(join(dir, 'traduccion_alineada.wav')));
  writeComparison(join(dir, 'comparacion.wav'), source, srcRate, output, rate);
  const label = `${corrida.label ?? basename(o.runDir)}-replay-${stretch.toFixed(2)}x`;
  const metrics = computeMetrics({ engine: corrida.engine, label, source, sourceRate: srcRate, output, outputRate: rate, chunks: entries.map((e) => ({ t: e.t, playStart: e.playStart, playEnd: e.playStart + (e.samples / rate) * 1000, samples: e.samples })), transcripts: [], statuses: [], sourceEndMs, runEndMs: cursor, thresholdMs: corrida.thresholdMs });
  writeFileSync(join(dir, 'metricas.json'), JSON.stringify(metrics, null, 2));
  writeFileSync(join(dir, 'resumen.md'), renderSummary(metrics));
  writeFileSync(join(dir, 'corrida.json'), JSON.stringify({ ...corrida, label, replayOf: o.runDir, triggerMs, stretch: canStretch ? stretch : 1, trimSilence: trim, finishedAt: new Date().toISOString() }, null, 2));
  return { dir, metrics, stretchedMs, trimmedMs, listeningMsBefore: originalCursor, listeningMsAfter: cursor };
}

/** Acorta las pausas internas mayores a 250 ms a 120 ms. */
export function trimPauses(pcm: Int16Array, rate: number, o: { minPauseMs?: number; keepMs?: number } = {}): Int16Array {
  const minPause = o.minPauseMs ?? 250;
  const keep = o.keepMs ?? 120;
  const segs = detectSpeech(pcm, rate, { mergeGapMs: 100, minSegmentMs: 80, thresholdDb: -48 });
  if (segs.length < 2) return pcm;
  const parts: Int16Array[] = [];
  let cursor = 0;
  for (let k = 0; k < segs.length; k++) {
    const gapStart = k === 0 ? 0 : segs[k - 1].end;
    const gap = segs[k].start - gapStart;
    if (k > 0 && gap >= minPause) {
      // conservar `keep` ms de la pausa: mitad al final de la anterior, mitad al inicio de esta
      const half = Math.round(((keep / 2) / 1000) * rate);
      parts.push(pcm.subarray(Math.round((cursor / 1000) * rate), Math.round((gapStart / 1000) * rate) + half));
      cursor = segs[k].start - keep / 2;
    }
  }
  parts.push(pcm.subarray(Math.round((cursor / 1000) * rate)));
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Int16Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function r1(v: number): number {
  return Math.round(v * 10) / 10;
}
