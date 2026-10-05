import { verdictFromLag, verdictFromPassRate, type Verdict } from './criteria.js';
import { evaluatePhrases, type PhraseSpec, type PhraseStats } from './phrases.js';
import { median, percentile } from './util.js';
import { detectSpeech, overlapMs, totalMs, type Segment } from './vad.js';

export interface ChunkRec {
  /** Momento de llegada (ms desde el inicio de la reproducción). */
  t: number;
  /** Momento en que un reproductor lo habría empezado a reproducir. */
  playStart: number;
  playEnd: number;
  samples: number;
}

export interface TranscriptRec {
  t: number;
  /** Momento de reproducción del audio más reciente al llegar este texto. */
  playRef: number;
  channel: 'source' | 'target';
  text: string;
  final: boolean;
}

export interface StatusRec {
  t: number;
  kind: 'status' | 'error' | 'closed' | 'ready';
  code?: string;
  message: string;
  data?: unknown;
}

export interface MetricsInput {
  engine: string;
  label: string;
  source: Int16Array;
  sourceRate: number;
  /** Traducción tal como la oiría un oyente (alineada en el tiempo con la fuente). */
  output: Int16Array;
  outputRate: number;
  chunks: ChunkRec[];
  transcripts: TranscriptRec[];
  statuses: StatusRec[];
  sourceEndMs: number;
  runEndMs: number;
  vadThresholdDb?: number;
  /** Umbral de latencia del MVP (ms). Por defecto 3000. */
  thresholdMs?: number;
  /** Frases cortas interactivas con sus tiempos exactos, si la corrida fue sobre un guion. */
  phrases?: PhraseSpec[];
}

export interface LagSample {
  /** Instante de la fuente que ancla la medición (fin o inicio de frase). */
  tMs: number;
  lagMs: number;
}

export interface LagStats {
  anchors: number;
  candidates: number;
  medianMs: number | null;
  p10Ms: number | null;
  p90Ms: number | null;
  p95Ms: number | null;
  minMs: number | null;
  maxMs: number | null;
  samples: LagSample[];
}

export interface Metrics {
  engine: string;
  label: string;
  sourceDurationMs: number;
  runDurationMs: number;
  sourceSpeechMs: number;
  outputSpeechMs: number;
  /** Habla traducida / habla original. >1 significa que la traducción habla más tiempo que el original. */
  speechRatio: number | null;
  sourceSegments: number;
  outputSegments: number;
  firstAudio: { sourceStartMs: number; firstChunkArrivalMs: number | null; outputStartMs: number | null; latencyMs: number | null } | null;
  firstCaptionMs: number | null;
  /** Fin de frase original → fin de la frase traducida. */
  phraseEndLag: LagStats;
  /** Inicio de frase original → inicio de la frase traducida. */
  phraseStartLag: LagStats;
  tailLagMs: number | null;
  drift: { slopeSecPer10Min: number | null; windows: Array<{ startMs: number; endMs: number; anchors: number; medianLagMs: number | null }> };
  /** Cuánto se acumuló audio en la cola del reproductor (el modelo emitió más rápido que tiempo real). */
  maxQueueMs: number;
  stalls: Array<{ startMs: number; endMs: number; durationMs: number; sourceSpeechMs: number }>;
  stability: {
    reconnects: number;
    rotations: number;
    unexpectedCloses: number;
    errors: number;
    droppedAudioMs: number;
    finishTimedOut: boolean;
    events: StatusRec[];
  };
  captions: { targetChars: number; sourceChars: number; targetDeltas: number };
  /** Veredicto contra el umbral de latencia. `heuristic` usa el retraso fin de frase; `phrases` la prueba interactiva. */
  latency: { thresholdMs: number; heuristic: Verdict; phrases: Verdict };
  phrases: PhraseStats | null;
  vad: { thresholdDb: number | null; pauseMs: number; minLagMs: number; maxLagMs: number };
}

const PAUSE_MS = 700; // pausa mínima en la fuente para considerar "fin de frase"
const MIN_LAG_MS = 100;
const MAX_LAG_MS = 12000;

export function computeMetrics(inp: MetricsInput): Metrics {
  const vadOpts = inp.vadThresholdDb !== undefined ? { thresholdDb: inp.vadThresholdDb } : {};
  const src = detectSpeech(inp.source, inp.sourceRate, vadOpts);
  const out = detectSpeech(inp.output, inp.outputRate, vadOpts);

  const phraseEnds = src.filter((s, i) => i === src.length - 1 || src[i + 1].start - s.end >= PAUSE_MS).map((s) => s.end);
  const phraseStarts = src.filter((s, i) => i === 0 || s.start - src[i - 1].end >= PAUSE_MS).map((s) => s.start);
  const endLag = matchMonotonic(phraseEnds, out.map((s) => s.end));
  const startLag = matchMonotonic(phraseStarts, out.map((s) => s.start));

  const firstAudio = src.length
    ? {
        sourceStartMs: src[0].start,
        firstChunkArrivalMs: inp.chunks.length ? inp.chunks[0].t : null,
        outputStartMs: out.length ? out[0].start : null,
        latencyMs: out.length ? out[0].start - src[0].start : null,
      }
    : null;

  const firstTarget = inp.transcripts.find((t) => t.channel === 'target' && t.text.trim().length > 0);
  const firstCaptionMs = firstTarget && src.length ? firstTarget.t - src[0].start : null;

  const medLag = endLag.medianMs ?? startLag.medianMs ?? 2000;
  const stalls = findStalls(src, out, medLag, inp.sourceEndMs);

  let maxQueueMs = 0;
  for (const c of inp.chunks) maxQueueMs = Math.max(maxQueueMs, c.playStart - c.t);

  const st = inp.statuses;
  const count = (pred: (s: StatusRec) => boolean) => st.filter(pred).length;
  let droppedAudioMs = 0;
  for (const s of st) {
    if (s.code === 'audio.buffered_flush') droppedAudioMs += Number((s.data as { droppedMs?: number } | undefined)?.droppedMs ?? 0);
  }

  const thresholdMs = inp.thresholdMs ?? 3000;
  const phrases = inp.phrases?.length ? evaluatePhrases(inp.phrases, inp.output, inp.outputRate, inp.transcripts, thresholdMs, inp.vadThresholdDb) : null;

  const targetDeltas = inp.transcripts.filter((t) => t.channel === 'target' && !t.final);
  const sourceDeltas = inp.transcripts.filter((t) => t.channel === 'source' && !t.final);

  return {
    engine: inp.engine,
    label: inp.label,
    sourceDurationMs: inp.sourceEndMs,
    runDurationMs: inp.runEndMs,
    sourceSpeechMs: totalMs(src),
    outputSpeechMs: totalMs(out),
    speechRatio: totalMs(src) > 0 ? totalMs(out) / totalMs(src) : null,
    sourceSegments: src.length,
    outputSegments: out.length,
    firstAudio,
    firstCaptionMs,
    phraseEndLag: endLag,
    phraseStartLag: startLag,
    tailLagMs: src.length && out.length ? out[out.length - 1].end - src[src.length - 1].end : null,
    drift: driftStats(endLag.samples, inp.sourceEndMs),
    maxQueueMs,
    stalls,
    stability: {
      reconnects: count((s) => s.code === 'session.reconnected' || s.code === 'session.resumed'),
      rotations: count((s) => s.code === 'session.rotated'),
      unexpectedCloses: count((s) => s.code === 'session.closed_unexpectedly'),
      errors: count((s) => s.kind === 'error'),
      droppedAudioMs,
      finishTimedOut: st.some((s) => s.code === 'finish.timeout'),
      events: st.filter((s) => s.kind === 'error' || (s.code !== undefined && !['session.opened', 'session.ready', 'session.closed'].includes(s.code))),
    },
    captions: {
      targetChars: targetDeltas.reduce((a, t) => a + t.text.length, 0),
      sourceChars: sourceDeltas.reduce((a, t) => a + t.text.length, 0),
      targetDeltas: targetDeltas.length,
    },
    latency: { thresholdMs, heuristic: verdictFromLag(endLag.medianMs, endLag.p90Ms, thresholdMs), phrases: verdictFromPassRate(phrases?.passRate ?? null) },
    phrases,
    vad: { thresholdDb: inp.vadThresholdDb ?? null, pauseMs: PAUSE_MS, minLagMs: MIN_LAG_MS, maxLagMs: MAX_LAG_MS },
  };
}

/**
 * Empareja cada instante de la fuente (fin o inicio de frase) con el instante
 * correspondiente de la salida, en orden y sin reutilizar salidas.
 *
 * 1. Se estima el retraso típico L como la moda de todas las diferencias
 *    plausibles salida − fuente (las parejas correctas se agrupan; las
 *    incorrectas se dispersan).
 * 2. Cada frase de la fuente se empareja con la salida libre más cercana a
 *    t + L dentro de una tolerancia. Si no hay ninguna, la frase queda sin
 *    emparejar (el motor la saltó o la fundió con otra) y no desplaza al resto.
 * 3. L se actualiza con la mediana de las últimas parejas para seguir una
 *    deriva lenta.
 *
 * Sigue siendo una heurística basada en pausas; el juez automático da el
 * emparejamiento exacto frase a frase.
 */
export function matchMonotonic(sourceTimes: number[], outputTimes: number[]): LagStats {
  const samples: LagSample[] = [];
  const typical = estimateTypicalLag(sourceTimes, outputTimes);
  if (typical !== null) {
    let L = typical;
    const recent: number[] = [];
    let j = 0;
    for (const t of sourceTimes) {
      while (j < outputTimes.length && outputTimes[j] < t + MIN_LAG_MS) j++;
      const tol = Math.max(2000, 0.75 * L);
      let best = -1;
      let bestD = Infinity;
      for (let k = j; k < outputTimes.length && outputTimes[k] <= t + L + tol; k++) {
        if (outputTimes[k] < t + L - tol) continue;
        const d = Math.abs(outputTimes[k] - (t + L));
        if (d < bestD) {
          best = k;
          bestD = d;
        }
      }
      if (best === -1) continue;
      const lag = outputTimes[best] - t;
      if (lag > MAX_LAG_MS) continue;
      samples.push({ tMs: t, lagMs: lag });
      j = best + 1;
      recent.push(lag);
      if (recent.length > 5) recent.shift();
      L = median(recent);
    }
  }
  const lags = samples.map((s) => s.lagMs).sort((a, b) => a - b);
  const q = (p: number) => (lags.length ? percentile(lags, p) : null);
  return {
    anchors: samples.length,
    candidates: sourceTimes.length,
    medianMs: q(0.5),
    p10Ms: q(0.1),
    p90Ms: q(0.9),
    p95Ms: q(0.95),
    minMs: lags.length ? lags[0] : null,
    maxMs: lags.length ? lags[lags.length - 1] : null,
    samples,
  };
}

/** Moda (en cajas de 250 ms) de las diferencias plausibles salida − fuente. */
function estimateTypicalLag(sourceTimes: number[], outputTimes: number[]): number | null {
  const bin = 250;
  const hist = new Map<number, number>();
  let j = 0;
  for (const t of sourceTimes) {
    while (j < outputTimes.length && outputTimes[j] < t + MIN_LAG_MS) j++;
    for (let k = j; k < outputTimes.length && outputTimes[k] <= t + MAX_LAG_MS; k++) {
      const idx = Math.floor((outputTimes[k] - t) / bin);
      hist.set(idx, (hist.get(idx) ?? 0) + 1);
    }
  }
  let bestIdx = -1;
  let bestCount = 0;
  for (const [idx, count] of [...hist.entries()].sort((a, b) => a[0] - b[0])) {
    if (count > bestCount) {
      bestCount = count;
      bestIdx = idx;
    }
  }
  return bestIdx < 0 ? null : (bestIdx + 0.5) * bin;
}

function driftStats(samples: LagSample[], durationMs: number): Metrics['drift'] {
  const windowMs = 5 * 60_000;
  const windows: Metrics['drift']['windows'] = [];
  for (let start = 0; start < Math.max(durationMs, 1); start += windowMs) {
    const end = Math.min(durationMs, start + windowMs);
    const inWin = samples.filter((s) => s.tMs >= start && s.tMs < end).map((s) => s.lagMs);
    windows.push({ startMs: start, endMs: end, anchors: inWin.length, medianLagMs: inWin.length ? median(inWin) : null });
  }
  let slope: number | null = null;
  if (samples.length >= 4) {
    const n = samples.length;
    const mx = samples.reduce((a, s) => a + s.tMs, 0) / n;
    const my = samples.reduce((a, s) => a + s.lagMs, 0) / n;
    let num = 0;
    let den = 0;
    for (const s of samples) {
      num += (s.tMs - mx) * (s.lagMs - my);
      den += (s.tMs - mx) ** 2;
    }
    if (den > 0) slope = ((num / den) * 600_000) / 1000; // segundos de retraso ganados por cada 10 minutos
  }
  return { slopeSecPer10Min: slope, windows };
}

/** Huecos de salida largos mientras la fuente sí tenía habla (descontando el retraso normal). */
function findStalls(src: Segment[], out: Segment[], lagMs: number, endMs: number): Metrics['stalls'] {
  const threshold = 5000 + lagMs;
  const gaps: Array<[number, number]> = [];
  let prevEnd = 0;
  for (const o of out) {
    gaps.push([prevEnd, o.start]);
    prevEnd = o.end;
  }
  gaps.push([prevEnd, endMs + lagMs]);
  const stalls: Metrics['stalls'] = [];
  for (const [a, b] of gaps) {
    if (b - a < threshold) continue;
    const speech = overlapMs(src, a - lagMs, b - lagMs);
    if (speech >= 3000) stalls.push({ startMs: a, endMs: b, durationMs: b - a, sourceSpeechMs: speech });
  }
  return stalls;
}
