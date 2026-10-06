import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readWav, readWavHeader, toMono } from '@voice-traductor/engines';
import { loadChunks, type ChunkEntry, type JudgeItem, type JudgeResult } from './judge.js';
import type { Metrics } from './metrics.js';
import { fmtClock, fmtSec, median, percentile } from './util.js';
import { detectSpeech } from './vad.js';

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

export interface DiagnoseResult {
  thresholdMs: number;
  connectMs: number | null;
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

export function diagnoseFromData(o: { chunks: ChunkEntry[]; rate: number; items: JudgeItem[]; jumps: JudgeResult['perceived']['jumps']; raw: Int16Array | null; speechRatio: number | null; connectMs: number | null; thresholdMs: number }): DiagnoseResult {
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

export function diagnoseRun(runDir: string, o: { thresholdMs?: number } = {}): DiagnoseResult {
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
  let connectMs: number | null = null;
  for (const line of readFileSync(join(runDir, 'eventos.jsonl'), 'utf8').split('\n')) {
    if (!line.includes('session.opened')) continue;
    try {
      const ev = JSON.parse(line) as { data?: { connectMs?: number } };
      if (typeof ev.data?.connectMs === 'number') {
        connectMs = ev.data.connectMs;
        break;
      }
    } catch {
      /* ignorar */
    }
  }
  const result = diagnoseFromData({ chunks, rate, items: judge?.items ?? [], jumps: judge?.perceived?.jumps ?? [], raw, speechRatio: metrics?.speechRatio ?? null, connectMs, thresholdMs });
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
  l.push(`- Conexión con OpenAI (apertura del WebSocket): ${r.connectMs === null ? 'no registrado en esta corrida' : r.connectMs + ' ms'}. La ida y vuelta de red por fragmento es del orden de la mitad.`);
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
