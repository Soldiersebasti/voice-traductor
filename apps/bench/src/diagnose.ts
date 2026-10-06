import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readWav, readWavHeader, toMono } from '@voice-traductor/engines';
import { loadAudioAtRate } from './audio-load.js';
import type { Reference } from './transcribe.js';
import { loadChunks, type ChunkEntry, type JudgeItem, type JudgeResult } from './judge.js';
import type { Metrics } from './metrics.js';
import { fmtClock, fmtSec, median, percentile } from './util.js';
import { detectSpeech, overlapMs, type Segment } from './vad.js';

/**
 * Descompone el retraso de una corrida en sus partes, a partir de los archivos
 * que ya existen (eventos.jsonl, metricas.json, juez.json, traduccion_cruda.wav):
 *
 *   retraso al empezar a oír una frase
 *     = llegada del primer audio de esa frase − inicio de la frase dicha   (modelo + red)
 *     + espera en la cola del reproductor                                   (nuestra reproducción)
 *
 * y el retraso al terminar de oírla suma además lo que la traducción dura de
 * más respecto al original. Con eso se ve cuánto es del modelo, cuánto es
 * acumulación y qué se puede recortar sin tocar el modelo.
 */
export interface Stat {
  n: number;
  medianMs: number | null;
  p90Ms: number | null;
  maxMs: number | null;
}

export interface JumpExplanation {
  heardMs: number;
  fromMs: number;
  toMs: number;
  text: string;
  pauseBeforeMs: number | null;
  mergedSources: number;
  durationRatio: number | null;
  cause: 'pausa del pastor' | 'alineación de varias frases' | 'traducción más corta' | 'sin explicar';
}

export interface GapForensic {
  /** Hueco en las llegadas del modelo (ms, línea de tiempo del oyente). */
  startMs: number;
  endMs: number;
  durationMs: number;
  /** Habla de la fuente durante el hueco (descontado el retraso típico). */
  sourceSpeechMs: number;
  sourceText: string | null;
  /** Fragmentos de transcripción de entrada que llegaron durante el hueco: prueba de que el modelo recibía audio. */
  inputDeltas: number;
  inputText: string;
  /** Lo primero que dijo el modelo al reanudar. */
  outputAfter: string;
  statusEvents: string[];
  verdict: 'el modelo recibía audio y retuvo la salida' | 'no llegó transcripción de entrada: revisar red o envío' | 'evento de sesión en el hueco' | 'sin transcripción de entrada activada';
}

export interface DiagnoseResult {
  thresholdMs: number;
  connectMs: number | null;
  rttMs: Stat | null;
  /** Inicio de habla en la fuente tras una pausa → primer fragmento de transcripción de entrada (proxy de subida + reconocimiento). */
  inputTranscriptLag: Stat | null;
  arrivalGaps: GapForensic[];
  chunks: { count: number; queueWait: Stat; shareQueued: number | null; chunkMs: number | null };
  bursts: { count: number; generationSpeed: Stat; audioPerBurstMs: Stat; singleChunkShare: number | null };
  sentences: { n: number; arrivalLag: Stat; queueLag: Stat; lagStart: Stat; lagEnd: Stat; durationRatio: Stat; excessPerMinuteMs: number | null };
  speechRatio: number | null;
  modelPauses: { totalMs: number; count: number; shareOfOutput: number | null };
  jumps: JumpExplanation[];
  whatIf: { lagStartIfNoQueueMedianMs: number | null; lagEndIfNoQueueMedianMs: number | null };
}

function stat(v: number[]): Stat {
  const s = [...v].sort((a, b) => a - b);
  return { n: s.length, medianMs: s.length ? median(s) : null, p90Ms: s.length ? percentile(s, 0.9) : null, maxMs: s.length ? s[s.length - 1] : null };
}

export function diagnoseFromData(o: { chunks: ChunkEntry[]; rate: number; items: JudgeItem[]; jumps: JudgeResult['perceived']['jumps']; raw: Int16Array | null; speechRatio: number | null; connectMs: number | null; thresholdMs: number; rttMs?: Stat | null; inputTranscriptLag?: Stat | null; arrivalGaps?: GapForensic[] }): DiagnoseResult {
  const { chunks, rate } = o;
  const dur = (c: ChunkEntry) => (c.samples / rate) * 1000;

  // 1. Cola del reproductor por fragmento.
  const queueWaits = chunks.map((c) => Math.max(0, c.playStart - c.t));
  const chunkMs = chunks.length ? median(chunks.map(dur)) : null;

  // 2. Ráfagas: fragmentos que llegan seguidos (< 300 ms entre llegadas) = una emisión del modelo.
  const bursts: Array<{ tStart: number; tEnd: number; audioMs: number; lastMs: number; n: number }> = [];
  for (const c of chunks) {
    const last = bursts[bursts.length - 1];
    if (last && c.t - last.tEnd < 300) {
      last.tEnd = c.t;
      last.audioMs += dur(c);
      last.lastMs = dur(c);
      last.n++;
    } else bursts.push({ tStart: c.t, tEnd: c.t, audioMs: dur(c), lastMs: dur(c), n: 1 });
  }
  // Velocidad de entrega: audio recibido antes del último fragmento dividido por el tiempo que tardó en llegar.
  // Solo ráfagas de 3+ fragmentos; una ráfaga de un solo fragmento grande es entrega instantánea.
  const speeds = bursts.filter((b) => b.n >= 3 && b.tEnd > b.tStart).map((b) => (b.audioMs - b.lastMs) / (b.tEnd - b.tStart));

  // 3. Por frase oída: llegada del primer audio vs. momento en que se empezó a oír.
  const sorted = [...chunks].sort((a, b) => a.playStart - b.playStart);
  const chunkAtPlay = (ms: number): ChunkEntry | null => {
    let lo = 0;
    let hi = sorted.length - 1;
    if (!sorted.length) return null;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (sorted[mid].playStart <= ms) lo = mid;
      else hi = mid - 1;
    }
    return sorted[lo];
  };
  const arrivalLags: number[] = [];
  const queueLags: number[] = [];
  const lagStarts: number[] = [];
  const lagEnds: number[] = [];
  const ratios: number[] = [];
  let excessMs = 0;
  let sourceSpanMs = 0;
  const items = o.items.filter((i) => typeof i.heardMs === 'number' && typeof i.sourceStartMs === 'number');
  for (const it of items) {
    const c = chunkAtPlay(it.heardMs as number);
    if (!c) continue;
    const arrival = c.t;
    arrivalLags.push(arrival - (it.sourceStartMs as number));
    queueLags.push(Math.max(0, (it.heardMs as number) - arrival));
    if (typeof it.lagStartMs === 'number') lagStarts.push(it.lagStartMs);
    if (typeof it.lagEndMs === 'number') lagEnds.push(it.lagEndMs);
    if (typeof it.heardEndMs === 'number' && typeof it.sourceEndMs === 'number') {
      const heardDur = (it.heardEndMs as number) - (it.heardMs as number);
      const srcDur = (it.sourceEndMs as number) - (it.sourceStartMs as number);
      if (srcDur > 300 && heardDur > 0) {
        ratios.push(heardDur / srcDur);
        excessMs += heardDur - srcDur;
        sourceSpanMs += srcDur;
      }
    }
  }

  // 4. Pausas del propio modelo dentro de la salida cruda (recortables).
  let pauseTotal = 0;
  let pauseCount = 0;
  let rawMs = 0;
  if (o.raw) {
    rawMs = (o.raw.length / rate) * 1000;
    const segs = detectSpeech(o.raw, rate, { mergeGapMs: 150, minSegmentMs: 100 });
    for (let k = 1; k < segs.length; k++) {
      const gap = segs[k].start - segs[k - 1].end;
      if (gap >= 250) {
        pauseTotal += gap - 120; // se puede acortar cada pausa a ~120 ms sin pegar palabras
        pauseCount++;
      }
    }
  }

  // 5. Saltos explicados.
  const byHeard = [...items].sort((a, b) => (a.heardMs as number) - (b.heardMs as number));
  const jumps: JumpExplanation[] = o.jumps.map((j) => {
    const idx = byHeard.findIndex((i) => i.heardMs === j.heardMs);
    const cur = idx >= 0 ? byHeard[idx] : null;
    const prev = idx > 0 ? byHeard[idx - 1] : null;
    const pauseBefore = cur && prev && typeof prev.sourceEndMs === 'number' && typeof cur.sourceStartMs === 'number' ? (cur.sourceStartMs as number) - (prev.sourceEndMs as number) : null;
    const merged = cur?.source_ids.length ?? 0;
    const ratio = cur && typeof cur.heardEndMs === 'number' && typeof cur.sourceEndMs === 'number' && typeof cur.sourceStartMs === 'number' && (cur.sourceEndMs as number) - (cur.sourceStartMs as number) > 300 ? ((cur.heardEndMs as number) - (cur.heardMs as number)) / ((cur.sourceEndMs as number) - (cur.sourceStartMs as number)) : null;
    let cause: JumpExplanation['cause'] = 'sin explicar';
    if (pauseBefore !== null && pauseBefore >= 1000) cause = 'pausa del pastor';
    else if (merged >= 2) cause = 'alineación de varias frases';
    else if (ratio !== null && ratio < 0.7) cause = 'traducción más corta';
    return { heardMs: j.heardMs, fromMs: j.fromMs, toMs: j.toMs, text: j.text, pauseBeforeMs: pauseBefore, mergedSources: merged, durationRatio: ratio, cause };
  });

  const arrival = stat(arrivalLags);
  const queue = stat(queueLags);
  const lagStart = stat(lagStarts);
  const lagEnd = stat(lagEnds);
  return {
    thresholdMs: o.thresholdMs,
    connectMs: o.connectMs,
    rttMs: o.rttMs ?? null,
    inputTranscriptLag: o.inputTranscriptLag ?? null,
    arrivalGaps: o.arrivalGaps ?? [],
    chunks: { count: chunks.length, queueWait: stat(queueWaits), shareQueued: chunks.length ? queueWaits.filter((q) => q > 500).length / chunks.length : null, chunkMs },
    bursts: { count: bursts.length, generationSpeed: stat(speeds.map((x) => x * 1000)), audioPerBurstMs: stat(bursts.map((b) => b.audioMs)), singleChunkShare: bursts.length ? bursts.filter((b) => b.n === 1).length / bursts.length : null },
    sentences: { n: items.length, arrivalLag: arrival, queueLag: queue, lagStart, lagEnd, durationRatio: stat(ratios.map((r) => r * 1000)), excessPerMinuteMs: sourceSpanMs > 0 ? (excessMs / sourceSpanMs) * 60_000 : null },
    speechRatio: o.speechRatio,
    modelPauses: { totalMs: pauseTotal, count: pauseCount, shareOfOutput: rawMs > 0 ? pauseTotal / rawMs : null },
    jumps,
    whatIf: {
      lagStartIfNoQueueMedianMs: arrival.medianMs,
      lagEndIfNoQueueMedianMs: lagEnd.medianMs !== null && queue.medianMs !== null ? lagEnd.medianMs - queue.medianMs : null,
    },
  };
}

interface EventLine {
  t: number;
  type: string;
  code?: string;
  message?: string;
  channel?: string;
  text?: string;
  final?: boolean;
  data?: { connectMs?: number; rttMs?: number };
}

function readEvents(runDir: string): EventLine[] {
  const path = join(runDir, 'eventos.jsonl');
  if (!existsSync(path)) return [];
  const out: EventLine[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line || line.includes('"type":"audio"') || line.includes('"type":"raw"')) continue;
    try {
      out.push(JSON.parse(line) as EventLine);
    } catch {
      /* ignorar */
    }
  }
  return out;
}

/**
 * Huecos en las llegadas del modelo mientras la fuente hablaba, con la
 * evidencia de qué pasaba en cada uno. Independiente de la reproducción.
 */
export function arrivalGapForensics(o: { chunks: ChunkEntry[]; rate: number; events: EventLine[]; source: Segment[]; lagMs: number; reference: Reference | null; minGapMs?: number }): GapForensic[] {
  const minGap = o.minGapMs ?? 2500;
  const inputDeltas = o.events.filter((e) => e.type === 'transcript' && e.channel === 'source' && !e.final);
  const outputDeltas = o.events.filter((e) => e.type === 'transcript' && e.channel === 'target' && !e.final);
  const statuses = o.events.filter((e) => e.type === 'status' || e.type === 'error');
  const hasInputTranscription = inputDeltas.length > 0;
  const out: GapForensic[] = [];
  const sorted = [...o.chunks].sort((a, b) => a.t - b.t);
  for (let k = 1; k < sorted.length; k++) {
    const a = sorted[k - 1].t + (sorted[k - 1].samples / o.rate) * 1000;
    const b = sorted[k].t;
    if (b - a < minGap) continue;
    const speech = overlapMs(o.source, a - o.lagMs, b - o.lagMs);
    if (speech < 1500) continue;
    const inWin = inputDeltas.filter((e) => e.t >= a && e.t <= b);
    const after = outputDeltas.filter((e) => e.t >= b && e.t <= b + 4000).map((e) => e.text ?? '').join('').replace(/\s+/g, ' ').trim();
    const st = statuses.filter((e) => e.t >= a - 2000 && e.t <= b + 2000 && e.code !== 'net.rtt').map((e) => `${(e.t / 1000).toFixed(1)}s ${e.code ?? e.type}: ${e.message ?? ''}`);
    const refText = o.reference ? o.reference.segments.filter((s) => s.end > a - o.lagMs && s.start < b - o.lagMs).map((s) => s.text).join(' ') : null;
    let verdict: GapForensic['verdict'];
    if (st.length) verdict = 'evento de sesión en el hueco';
    else if (!hasInputTranscription) verdict = 'sin transcripción de entrada activada';
    else if (inWin.length > 0) verdict = 'el modelo recibía audio y retuvo la salida';
    else verdict = 'no llegó transcripción de entrada: revisar red o envío';
    out.push({ startMs: a, endMs: b, durationMs: b - a, sourceSpeechMs: speech, sourceText: refText, inputDeltas: inWin.length, inputText: inWin.map((e) => e.text ?? '').join('').replace(/\s+/g, ' ').trim().slice(0, 220), outputAfter: after.slice(0, 220), statusEvents: st, verdict });
  }
  return out;
}

/** Inicio de habla tras una pausa → primer fragmento de transcripción de entrada. */
export function inputTranscriptLagStat(events: EventLine[], source: Segment[]): Stat | null {
  const deltas = events.filter((e) => e.type === 'transcript' && e.channel === 'source' && !e.final && (e.text ?? '').trim()).map((e) => e.t).sort((a, b) => a - b);
  if (!deltas.length) return null;
  const starts = source.filter((s, i) => i === 0 || s.start - source[i - 1].end >= 700).map((s) => s.start);
  const lags: number[] = [];
  let j = 0;
  for (const s of starts) {
    while (j < deltas.length && deltas[j] < s) j++;
    if (j >= deltas.length) break;
    const lag = deltas[j] - s;
    if (lag <= 6000) lags.push(lag);
  }
  return lags.length ? stat(lags) : null;
}

export async function diagnoseRun(runDir: string, o: { thresholdMs?: number; reference?: Reference | null; log?: (line: string) => void } = {}): Promise<DiagnoseResult> {
  const log = o.log ?? (() => {});
  const thresholdMs = o.thresholdMs ?? 3000;
  const chunks = loadChunks(runDir);
  if (!chunks.length) throw new Error(`No hay fragmentos de audio en ${join(runDir, 'eventos.jsonl')}`);
  const rawPath = join(runDir, 'traduccion_cruda.wav');
  const rate = existsSync(rawPath) ? readWavHeader(rawPath).sampleRate : 24000;
  const raw = existsSync(rawPath) ? toMono(readWav(rawPath)) : null;
  const jPath = join(runDir, 'juez.json');
  const judge = existsSync(jPath) ? (JSON.parse(readFileSync(jPath, 'utf8')) as JudgeResult) : null;
  const mPath = join(runDir, 'metricas.json');
  const metrics = existsSync(mPath) ? (JSON.parse(readFileSync(mPath, 'utf8')) as Metrics) : null;
  const events = readEvents(runDir);
  let connectMs: number | null = null;
  const rtts: number[] = [];
  for (const e of events) {
    if (e.code === 'session.opened' && typeof e.data?.connectMs === 'number' && connectMs === null) connectMs = e.data.connectMs;
    if (e.code === 'net.rtt' && typeof e.data?.rttMs === 'number') rtts.push(e.data.rttMs);
  }

  // Fuente: segmentos de habla, para situar los huecos.
  let source: Segment[] = [];
  let inputTranscriptLag: Stat | null = null;
  let arrivalGaps: GapForensic[] = [];
  const cPath = join(runDir, 'corrida.json');
  if (existsSync(cPath)) {
    const corrida = JSON.parse(readFileSync(cPath, 'utf8')) as { input?: string; engine?: string; maxMinutes?: number; startMs?: number };
    if (corrida.input && existsSync(corrida.input)) {
      try {
        const srcRate = corrida.engine === 'openai' ? 24000 : 16000;
        const pcm = await loadAudioAtRate(corrida.input, srcRate, { maxMs: corrida.maxMinutes ? corrida.maxMinutes * 60_000 : undefined, startMs: corrida.startMs, log });
        source = detectSpeech(pcm, srcRate);
        const lag = metrics?.phraseEndLag.medianMs ?? judge?.perceived?.lagStart.medianMs ?? 2000;
        inputTranscriptLag = inputTranscriptLagStat(events, source);
        arrivalGaps = arrivalGapForensics({ chunks, rate, events, source, lagMs: lag, reference: o.reference ?? null });
      } catch (err) {
        log(`No se pudo cargar la fuente para el forense de huecos: ${(err as Error).message}`);
      }
    } else log('corrida.json no apunta a un archivo de entrada existente; se omite el forense de huecos.');
  }

  const result = diagnoseFromData({ chunks, rate, items: judge?.items ?? [], jumps: judge?.perceived?.jumps ?? [], raw, speechRatio: metrics?.speechRatio ?? null, connectMs, thresholdMs, rttMs: rtts.length ? stat(rtts) : null, inputTranscriptLag, arrivalGaps });
  writeFileSync(join(runDir, 'diagnostico.json'), JSON.stringify(result, null, 2));
  writeFileSync(join(runDir, 'diagnostico.md'), renderDiagnose(result, Boolean(judge)));
  return result;
}

const st = (s: Stat, d = 2) => (s.n ? `mediana ${fmtSec(s.medianMs, d)}, p90 ${fmtSec(s.p90Ms, d)}, máx ${fmtSec(s.maxMs, d)} (${s.n})` : 'sin datos');

export function renderDiagnose(r: DiagnoseResult, hasJudge: boolean): string {
  const l: string[] = [];
  l.push('# Diagnóstico de latencia', '');
  l.push('Descomposición del retraso a partir de los archivos de la corrida. "Llegada" es cuando el audio traducido llegó por la red; "cola" es lo que esperó en el reproductor porque todavía sonaba la frase anterior.', '');
  l.push('## De dónde viene el retraso', '');
  l.push(`- Conexión con OpenAI (apertura del WebSocket): ${r.connectMs === null ? 'no registrado en esta corrida' : r.connectMs + ' ms'}. Ida y vuelta de red (ping/pong): ${r.rttMs ? st(r.rttMs, 3) : 'no registrada (corridas anteriores a esta versión)'}.`);
  l.push(`- Subida + reconocimiento (inicio de habla tras una pausa → primer fragmento de transcripción de entrada): ${r.inputTranscriptLag ? st(r.inputTranscriptLag) : 'sin datos (requiere transcripción de entrada activada)'}. Es el tiempo que tarda OpenAI en "oír" lo que se envió; lo que falte hasta la llegada del audio traducido es espera del modelo.`);
  l.push(`- Fragmentos de entrada: ${r.chunks.chunkMs === null ? '-' : Math.round(r.chunks.chunkMs) + ' ms'} por fragmento de salida; la entrada se envía cada 100 ms. Aporte de nuestro troceado: menos de 0,2 s en total.`);
  if (hasJudge && r.sentences.n) {
    l.push(`- **Modelo + red** (inicio de frase dicha → llegada del primer audio de su traducción): ${st(r.sentences.arrivalLag)}.`);
    l.push(`- **Cola del reproductor** (llegada → momento en que se empezó a oír): ${st(r.sentences.queueLag)}.`);
    l.push(`- Retraso al empezar a oír (suma de los dos): ${st(r.sentences.lagStart)}.`);
    l.push(`- Retraso al terminar de oír: ${st(r.sentences.lagEnd)}.`);
    l.push(`- Duración de la frase oída / frase dicha: mediana ${r.sentences.durationRatio.medianMs === null ? '-' : (r.sentences.durationRatio.medianMs / 1000).toFixed(2)}, p90 ${r.sentences.durationRatio.p90Ms === null ? '-' : (r.sentences.durationRatio.p90Ms / 1000).toFixed(2)}. Exceso acumulado: ${r.sentences.excessPerMinuteMs === null ? '-' : fmtSec(r.sentences.excessPerMinuteMs, 1) + ' por cada minuto de prédica'}.`);
  } else {
    l.push('- Correr `judge` primero para descomponer por frase (modelo + red frente a cola).');
  }
  l.push(`- Habla traducida / habla original en toda la corrida: ${r.speechRatio === null ? '-' : r.speechRatio.toFixed(2)}.`);
  l.push(`- Velocidad de entrega del modelo (audio recibido por segundo de reloj dentro de cada ráfaga): ${r.bursts.generationSpeed.medianMs === null ? 'sin ráfagas largas' : (r.bursts.generationSpeed.medianMs / 1000).toFixed(2) + 'x'} (mediana); ${r.bursts.count} ráfagas de ${fmtSec(r.bursts.audioPerBurstMs.medianMs, 1)} de audio en mediana${r.bursts.singleChunkShare !== null && r.bursts.singleChunkShare > 0.5 ? '; la mayoría llegan en un solo bloque (entrega instantánea)' : ''}.`);
  l.push(`- Fragmentos que esperaron más de 0,5 s en cola: ${r.chunks.shareQueued === null ? '-' : Math.round(r.chunks.shareQueued * 100) + '%'}; espera en cola por fragmento ${st(r.chunks.queueWait)}.`);
  l.push(`- Pausas del propio modelo dentro de la traducción: ${r.modelPauses.count} pausas de ≥ 0,25 s, ${fmtSec(r.modelPauses.totalMs, 1)} recortables en total (${r.modelPauses.shareOfOutput === null ? '-' : Math.round(r.modelPauses.shareOfOutput * 100) + '%'} de la salida).`, '');

  l.push('## Qué significa', '');
  l.push('- Si la **cola** es grande y la velocidad de generación es mayor que 1x, el modelo ya tenía la traducción lista y el cuello de botella es que la traducción tarda más en decirse de lo que el pastor tardó en decirla. Eso no se arregla con el modelo: se arregla acortando la escucha (hablar un poco más rápido, recortar pausas) o aceptando el retraso.');
  l.push('- Si la **llegada** ya está cerca del umbral, el retraso es del modelo (espera contexto antes de hablar) y solo se reduce cambiando de motor o de parámetros del motor.');
  l.push(`- Sin cola, el retraso al empezar a oír quedaría en mediana ${fmtSec(r.whatIf.lagStartIfNoQueueMedianMs)} y al terminar en ${fmtSec(r.whatIf.lagEndIfNoQueueMedianMs)}. El comando \`replay\` simula eso con reproducción adaptativa sin volver a llamar al modelo.`, '');

  if (r.arrivalGaps.length) {
    l.push('## Huecos en las llegadas del modelo mientras la fuente hablaba', '');
    l.push('Medidos en las llegadas por la red, no en la reproducción: durante estos intervalos no llegó audio traducido aunque el pastor hablaba. Para cada uno se muestra la evidencia: si siguieron llegando fragmentos de transcripción de entrada (el modelo recibía audio), qué decía el pastor y qué dijo el modelo al reanudar.', '');
    for (const g of r.arrivalGaps) {
      l.push(`### ${fmtClock(g.startMs)} a ${fmtClock(g.endMs)}: ${fmtSec(g.durationMs, 1)} sin audio traducido; la fuente habló ${fmtSec(g.sourceSpeechMs, 1)}`, '');
      l.push(`- Veredicto: **${g.verdict}**.`);
      l.push(`- Transcripción de entrada recibida durante el hueco: ${g.inputDeltas} fragmentos${g.inputText ? `: "${g.inputText}"` : ''}.`);
      if (g.sourceText) l.push(`- Lo que decía el pastor (referencia): "${g.sourceText.slice(0, 300)}"`);
      l.push(`- Lo primero que dijo el modelo al reanudar: "${g.outputAfter || '-'}"`);
      for (const e of g.statusEvents) l.push(`- Evento: ${e}`);
      l.push('');
    }
    const counts: Record<string, number> = {};
    for (const g of r.arrivalGaps) counts[g.verdict] = (counts[g.verdict] ?? 0) + 1;
    l.push(`Resumen de huecos: ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join('; ')}.`, '');
  } else {
    l.push('## Huecos en las llegadas del modelo', '', '- No hubo huecos de 2,5 s o más en las llegadas mientras la fuente hablaba, o no se pudo cargar la fuente (ver corrida.json).', '');
  }

  if (r.jumps.length) {
    l.push('## Saltos explicados', '');
    l.push('Un salto es una caída del retraso de más de 1,5 s entre una frase y la siguiente. Sin omisiones, casi siempre es la cola vaciándose en una pausa del pastor, no contenido perdido.', '');
    l.push('| Minuto | De | A | Causa probable | Pausa previa del pastor | Frases del original unidas | Duración oída/dicha | Texto |', '|---|---|---|---|---|---|---|---|');
    for (const j of r.jumps) l.push(`| ${fmtClock(j.heardMs)} | ${fmtSec(j.fromMs, 1)} | ${fmtSec(j.toMs, 1)} | ${j.cause} | ${fmtSec(j.pauseBeforeMs, 1)} | ${j.mergedSources} | ${j.durationRatio === null ? '-' : j.durationRatio.toFixed(2)} | ${j.text.slice(0, 80)} |`);
    const counts: Record<string, number> = {};
    for (const j of r.jumps) counts[j.cause] = (counts[j.cause] ?? 0) + 1;
    l.push('', `Resumen: ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ')}.`, '');
  }
  return l.join('\n');
}
